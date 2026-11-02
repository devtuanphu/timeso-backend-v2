-- "Mong muốn được hỗ trợ" của nhân viên cho từng loại lịch cá nhân (app nhân
-- viên → Lịch trống / Lịch bận / Lịch học → Hỗ trợ), vd "Làm 4 ca/tuần, ưu
-- tiên ca tối". Chủ xem ở chi tiết nhân viên → Lịch cá nhân.
--
-- Dạng {"AVAILABLE": "...", "BUSY": "...", "STUDY": "..."}; thiếu khoá = chưa
-- nhập. Mỗi chuỗi tối đa 200 ký tự (kiểm ở API).
--
-- Thứ tự: chạy TRƯỚC khi deploy backend đọc cột này. Chỉ thêm cột NULL (không
-- ghi lại bảng), chạy lại được.
--
-- Run: scripts/migrate.sh apply migration_personal_schedule_wishes.sql

\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE employee_profiles
  ADD COLUMN IF NOT EXISTS personal_schedule_wishes jsonb;

COMMENT ON COLUMN employee_profiles.personal_schedule_wishes IS
  'Mong muốn được hỗ trợ theo loại lịch cá nhân: {AVAILABLE|BUSY|STUDY: text}';

COMMIT;
