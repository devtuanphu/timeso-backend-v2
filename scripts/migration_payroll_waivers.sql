-- Chủ xoá (miễn) một khoản thưởng / vi phạm trong popup "Chi tiết thưởng /
-- vi phạm" của sao kê lương (app chủ), kèm lý do bắt buộc.
--
-- Khoản tự động (đi muộn, về sớm, nghỉ không phép, tăng ca…) tính lại từ chấm
-- công mỗi lần nên không xoá được dòng nào — lần xoá được lưu ở đây và lúc
-- tính lương bỏ lần đó ra (payroll-calculation.utils.ts applyPayrollWaivers):
--   * OCCURRENCE: một lần phát sinh của một khoản (khoản + ca, assignment_id);
--   * LINE: cả dòng của khoản trong tháng (khoản tính cả tháng: mốc, chuyên
--     cần, % lương tháng… — không gắn với ca nào);
--   * RECORD: ghi nhận tay (employee_payroll_records) bị xoá mềm cùng lúc —
--     dòng ở đây chỉ để giữ lý do, không tham gia tính lương.
-- Khoản = rule_lineage_id (lineage_id của khoản, hoặc id nếu chưa có phiên
-- bản), để sửa khoản giữa tháng không làm lần đã xoá hiện lại.
--
-- Order: run BEFORE deploying the backend that reads the table (tính lương
-- đọc bảng này mỗi lần). Safe to re-run. Additive only.
--
-- Run: scripts/migrate.sh apply migration_payroll_waivers.sql

\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS employee_payroll_waivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  deleted_at timestamp,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  employee_profile_id uuid NOT NULL REFERENCES employee_profiles(id) ON DELETE CASCADE,
  kind varchar(16) NOT NULL CHECK (kind IN ('OCCURRENCE', 'LINE', 'RECORD')),
  category varchar(16) NOT NULL,
  rule_lineage_id uuid NOT NULL,
  rule_name varchar(255) NOT NULL,
  period_start date NOT NULL,
  assignment_id uuid,
  record_id uuid,
  work_date date,
  reason varchar(300) NOT NULL,
  created_by_account_id uuid,
  CHECK (kind <> 'OCCURRENCE' OR assignment_id IS NOT NULL),
  CHECK (kind <> 'RECORD' OR record_id IS NOT NULL)
);

COMMENT ON TABLE employee_payroll_waivers IS
  'Khoản thưởng / vi phạm chủ đã xoá (miễn) khỏi lương tháng, kèm lý do';

-- Tính lương đọc theo nhân viên + kỳ.
CREATE INDEX IF NOT EXISTS idx_employee_payroll_waivers_employee_period
  ON employee_payroll_waivers (employee_profile_id, period_start)
  WHERE deleted_at IS NULL;

-- Bấm xoá hai lần / gửi lại: không thêm dòng thứ hai.
CREATE UNIQUE INDEX IF NOT EXISTS uq_employee_payroll_waivers_occurrence
  ON employee_payroll_waivers (employee_profile_id, rule_lineage_id, assignment_id)
  WHERE deleted_at IS NULL AND kind = 'OCCURRENCE';
CREATE UNIQUE INDEX IF NOT EXISTS uq_employee_payroll_waivers_line
  ON employee_payroll_waivers (employee_profile_id, rule_lineage_id, period_start)
  WHERE deleted_at IS NULL AND kind = 'LINE';
CREATE UNIQUE INDEX IF NOT EXISTS uq_employee_payroll_waivers_record
  ON employee_payroll_waivers (record_id)
  WHERE deleted_at IS NULL AND kind = 'RECORD';

COMMIT;
