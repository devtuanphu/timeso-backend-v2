-- Thiết lập tính lương v2: khoản thưởng / vi phạm bật-tắt với cách tính chung
-- (hệ số / số tiền × giờ / ca, hoặc số tiền khi đạt mốc giờ / ca) và các lần
-- chủ "ghi nhận" một khoản cho từng nhân viên.
--
-- store_payroll_rules: code / calc_mode / threshold / description. Dòng có
-- calc_mode NULL là quy tắc cũ, backend vẫn tính theo rule_type như trước.
-- code được điền từ rule_type cho các dòng thưởng / phạt cũ, để màn mới sửa
-- đúng dòng đó (không tạo dòng thứ hai cùng loại và trả hai lần).
--
-- employee_payroll_records: số lượng (giờ / ca / lần) chủ ghi nhận cho một
-- khoản thủ công (trách nhiệm, doanh số, thưởng nóng, làm sai quy định, khoản
-- tự thêm). Giữ tên + loại khoản lúc ghi, để xoá khoản không làm mất lịch sử.
--
-- Order: run BEFORE deploying the backend that reads the new columns.
-- Safe to re-run. Additive only.
--
-- Run: scripts/migrate.sh apply migration_payroll_rules_v2.sql

\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE store_payroll_rules ADD COLUMN IF NOT EXISTS code varchar(32);
ALTER TABLE store_payroll_rules ADD COLUMN IF NOT EXISTS calc_mode varchar(24);
ALTER TABLE store_payroll_rules ADD COLUMN IF NOT EXISTS threshold numeric(10,2);
ALTER TABLE store_payroll_rules ADD COLUMN IF NOT EXISTS description text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_store_payroll_rules_calc_mode'
  ) THEN
    ALTER TABLE store_payroll_rules ADD CONSTRAINT chk_store_payroll_rules_calc_mode
      CHECK (calc_mode IS NULL OR calc_mode IN (
        'COEF_PER_HOUR', 'COEF_PER_SHIFT', 'AMOUNT_PER_HOUR', 'AMOUNT_PER_SHIFT',
        'MILESTONE_HOURS', 'MILESTONE_SHIFTS'));
  END IF;
END $$;

-- Legacy bonus / fine rows: code from rule_type (calc_mode stays NULL, so the
-- legacy maths keeps applying until the owner re-saves the row in the new UI).
-- One row per (store, category, code) keeps the preset code — the active one,
-- then the newest; the others (e.g. a deactivated seeded "Thưởng chuyên cần"
-- next to the owner's own) become CUSTOM, so the new screen never sees two
-- rows of one preset. A re-run never gives a code that a row already holds.
WITH mapped AS (
  SELECT id, store_id, category, is_active, created_at,
         CASE rule_type
           WHEN 'ATTENDANCE' THEN 'ATTENDANCE'
           WHEN 'LATE' THEN 'LATE'
           WHEN 'EARLY' THEN 'EARLY'
           WHEN 'ABSENT' THEN 'ABSENT'
           WHEN 'MISSING_CHECK' THEN 'MISSED_PUNCH'
           WHEN 'KPI' THEN 'SALES'
           WHEN 'DISCIPLINE' THEN 'RULE_VIOLATION'
           ELSE 'CUSTOM'
         END AS new_code
    FROM store_payroll_rules
   WHERE code IS NULL
     AND category IN ('bonus', 'fine')
), ranked AS (
  SELECT m.id, m.new_code,
         row_number() OVER (
           PARTITION BY m.store_id, m.category, m.new_code
           ORDER BY m.is_active DESC, m.created_at DESC
         ) AS rn,
         EXISTS (
           SELECT 1 FROM store_payroll_rules o
            WHERE o.store_id = m.store_id
              AND o.category = m.category
              AND o.code = m.new_code
              AND o.deleted_at IS NULL
         ) AS taken
    FROM mapped m
)
UPDATE store_payroll_rules r
   SET code = CASE
                WHEN ranked.new_code <> 'CUSTOM' AND (ranked.rn > 1 OR ranked.taken)
                  THEN 'CUSTOM'
                ELSE ranked.new_code
              END
  FROM ranked
 WHERE r.id = ranked.id;

CREATE TABLE IF NOT EXISTS employee_payroll_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  deleted_at timestamp,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  employee_profile_id uuid NOT NULL REFERENCES employee_profiles(id) ON DELETE CASCADE,
  rule_id uuid REFERENCES store_payroll_rules(id) ON DELETE SET NULL,
  rule_name varchar(255) NOT NULL,
  category varchar(16) NOT NULL CHECK (category IN ('bonus', 'fine')),
  work_date date NOT NULL,
  quantity numeric(10,2) NOT NULL CHECK (quantity > 0 AND quantity <= 1000),
  note text,
  created_by_account_id uuid
);

CREATE INDEX IF NOT EXISTS idx_employee_payroll_records_employee_date
  ON employee_payroll_records (employee_profile_id, work_date)
  WHERE deleted_at IS NULL;

COMMIT;
