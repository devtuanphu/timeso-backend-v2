-- Note 14 (app chủ): ba nhóm cột mới, chỉ THÊM cột, chạy lại được.
--
-- 1. Thiết lập ca làm & chấm công → "Ca linh hoạt": phạm vi áp dụng.
--    flexible_shift_scope  ALL = toàn bộ nhân viên, SELECTED = chỉ những người
--    trong flexible_shift_employee_ids (simple-array, giống
--    location_exception_emp_ids). Mới chỉ lưu — chấm công / lương chưa đọc.
-- 2. Ghi nhận thưởng / vi phạm tay (employee_payroll_records.amount): số tiền
--    của riêng lần đó ("lần này 30k, lần sau 20k"). NULL = tính theo cách tính
--    của khoản như trước, nên mọi ghi nhận cũ giữ nguyên số tiền.
-- 3. Mẫu bảng lương → "Thêm hàng" (store_payslip_rows.unit): cách tính của
--    hàng tự thêm. MONTH = số tiền cố định mỗi tháng (như trước, mặc định cho
--    mọi hàng đã có); DAY / HOUR / SHIFT = đơn giá × ngày công / giờ làm / ca
--    hoàn thành của từng nhân viên trong tháng.
--
-- Thứ tự: chạy TRƯỚC khi deploy backend (entity đọc các cột này mỗi lần tải
-- thiết lập chấm công, ghi nhận và mẫu bảng lương).
--
-- Run: scripts/migrate.sh apply migration_note14_settings_payroll.sql

\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE store_timekeeping_settings
  ADD COLUMN IF NOT EXISTS flexible_shift_scope varchar(16) NOT NULL DEFAULT 'ALL',
  ADD COLUMN IF NOT EXISTS flexible_shift_employee_ids text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_store_timekeeping_flexible_scope'
  ) THEN
    ALTER TABLE store_timekeeping_settings
      ADD CONSTRAINT chk_store_timekeeping_flexible_scope
      CHECK (flexible_shift_scope IN ('ALL', 'SELECTED'));
  END IF;
END $$;

COMMENT ON COLUMN store_timekeeping_settings.flexible_shift_scope IS
  'Ca linh hoạt áp dụng cho: ALL = toàn bộ nhân viên, SELECTED = flexible_shift_employee_ids';
COMMENT ON COLUMN store_timekeeping_settings.flexible_shift_employee_ids IS
  'Nhân viên (employee_profiles.id, phân cách dấu phẩy) khi flexible_shift_scope = SELECTED';

ALTER TABLE employee_payroll_records
  ADD COLUMN IF NOT EXISTS amount numeric(12, 2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_employee_payroll_records_amount'
  ) THEN
    ALTER TABLE employee_payroll_records
      ADD CONSTRAINT chk_employee_payroll_records_amount
      CHECK (amount IS NULL OR amount > 0);
  END IF;
END $$;

COMMENT ON COLUMN employee_payroll_records.amount IS
  'Số tiền của riêng lần ghi nhận này (đồng); NULL = theo cách tính của khoản';

ALTER TABLE store_payslip_rows
  ADD COLUMN IF NOT EXISTS unit varchar(16) NOT NULL DEFAULT 'MONTH';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_store_payslip_rows_unit'
  ) THEN
    ALTER TABLE store_payslip_rows
      ADD CONSTRAINT chk_store_payslip_rows_unit
      CHECK (unit IN ('MONTH', 'DAY', 'HOUR', 'SHIFT'));
  END IF;
END $$;

COMMENT ON COLUMN store_payslip_rows.unit IS
  'Cách tính hàng tự thêm: MONTH = cố định / tháng; DAY / HOUR / SHIFT = amount × ngày công / giờ làm / ca';

COMMIT;
