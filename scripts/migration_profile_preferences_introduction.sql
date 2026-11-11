-- Hồ sơ nhân viên theo cửa hàng:
--  - "Mong muốn số ngày làm (tham khảo)" 1–7 ngày/tuần và "Mong muốn số giờ mỗi
--    ca (tham khảo)" 1–12 tiếng/ca, nhân viên tự chọn ở app nhân viên → Lịch
--    học / Lịch bận → Hỗ trợ. Chỉ để chủ tham khảo: KHÔNG phải giới hạn
--    work_days_per_week (giới hạn đó chặn đăng ký ca).
--  - "Giới thiệu bản thân" lấy từ đơn ứng tuyển khi chủ nhận ứng viên.
--
-- Thứ tự: chạy TRƯỚC khi deploy backend có các cột này trong entity — TypeORM
-- ghi mọi cột của entity khi INSERT employee_profiles, thiếu cột thì mọi lần
-- thêm / nhận / tuyển lại nhân viên đều lỗi. Chỉ thêm cột NULL (không ghi lại
-- bảng), chạy lại được.
--
-- Run: scripts/migrate.sh apply migration_profile_preferences_introduction.sql

\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE employee_profiles
  ADD COLUMN IF NOT EXISTS desired_days_per_week smallint,
  ADD COLUMN IF NOT EXISTS desired_hours_per_shift smallint,
  ADD COLUMN IF NOT EXISTS introduction text;

ALTER TABLE employee_profiles
  DROP CONSTRAINT IF EXISTS employee_profiles_desired_days_per_week_check;
ALTER TABLE employee_profiles
  ADD CONSTRAINT employee_profiles_desired_days_per_week_check
  CHECK (desired_days_per_week BETWEEN 1 AND 7);

ALTER TABLE employee_profiles
  DROP CONSTRAINT IF EXISTS employee_profiles_desired_hours_per_shift_check;
ALTER TABLE employee_profiles
  ADD CONSTRAINT employee_profiles_desired_hours_per_shift_check
  CHECK (desired_hours_per_shift BETWEEN 1 AND 12);

COMMENT ON COLUMN employee_profiles.desired_days_per_week IS
  'Mong muốn số ngày làm mỗi tuần (tham khảo, nhân viên tự chọn) 1–7; không phải giới hạn đăng ký ca';
COMMENT ON COLUMN employee_profiles.desired_hours_per_shift IS
  'Mong muốn số giờ mỗi ca (tham khảo, nhân viên tự chọn) 1–12';
COMMENT ON COLUMN employee_profiles.introduction IS
  'Giới thiệu bản thân của nhân viên ở cửa hàng này, chép từ đơn ứng tuyển khi được nhận';

COMMIT;
