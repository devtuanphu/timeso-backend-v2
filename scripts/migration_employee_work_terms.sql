-- Điều kiện làm việc riêng của từng nhân viên (app chủ → Sửa thông tin nhân viên).
--
-- - official_start_date: ngày chính thức vào làm (giờ VN), khác lúc được thêm
--   vào app (joined_at). Trước ngày này nhân viên không đăng ký và không được
--   xếp ca. NULL = không giới hạn (như trước).
-- - work_days_per_week / work_days_per_month: số ngày làm tối đa nhân viên tự
--   đăng ký trong một tuần (T2–CN) / một tháng dương lịch. NULL = không giới hạn.
-- - fixed_days_off: ngày nghỉ cố định hằng tuần, 0 = Chủ nhật … 6 = Thứ 7
--   (cùng quy ước daysOfWeek của đăng ký ca cố định).
-- - owner_note: ghi chú của chủ về mong muốn của nhân viên. Chỉ chủ đọc được.
--
-- Luật áp dụng ở src/modules/stores/work-terms.utils.ts.
--
-- Thứ tự: chạy TRƯỚC khi deploy backend đọc các cột này. Chỉ thêm cột (giá trị
-- mặc định hằng số, không viết lại bảng), chạy lại được.
--
-- Run: scripts/migrate.sh apply migration_employee_work_terms.sql

\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE employee_profiles
  ADD COLUMN IF NOT EXISTS official_start_date date,
  ADD COLUMN IF NOT EXISTS work_days_per_week smallint,
  ADD COLUMN IF NOT EXISTS work_days_per_month smallint,
  ADD COLUMN IF NOT EXISTS fixed_days_off smallint[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS owner_note text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_employee_profiles_work_terms'
  ) THEN
    ALTER TABLE employee_profiles
      ADD CONSTRAINT chk_employee_profiles_work_terms CHECK (
        (work_days_per_week IS NULL OR work_days_per_week BETWEEN 1 AND 7)
        AND (work_days_per_month IS NULL OR work_days_per_month BETWEEN 1 AND 31)
        AND fixed_days_off <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::smallint[]
        AND cardinality(fixed_days_off) <= 6
        AND (owner_note IS NULL OR char_length(owner_note) <= 1000)
      );
  END IF;
END $$;

COMMIT;
