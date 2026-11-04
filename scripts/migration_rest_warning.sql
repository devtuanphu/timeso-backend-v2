-- Cảnh báo giờ nghỉ tối thiểu giữa hai ca (app chủ → Thiết lập ca làm &
-- chấm công). Bộ luật Lao động: người làm theo ca được nghỉ ít nhất 12 giờ
-- trước khi chuyển sang ca khác. Chỉ cảnh báo khi chủ chọn nhân viên cho ca,
-- không chặn; mặc định tắt nên cửa hàng cũ không thấy gì khác.
--
-- Thứ tự: chạy TRƯỚC khi deploy backend (entity đọc hai cột này ở mọi lần
-- tải thiết lập chấm công). Chỉ thêm cột có mặc định, chạy lại được.
--
-- Run: scripts/migrate.sh apply migration_rest_warning.sql

\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE store_timekeeping_settings
  ADD COLUMN IF NOT EXISTS rest_warning_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS min_rest_minutes integer NOT NULL DEFAULT 720;

COMMENT ON COLUMN store_timekeeping_settings.rest_warning_enabled IS
  'Cảnh báo khi hai ca của cùng nhân viên cách nhau ít hơn min_rest_minutes';
COMMENT ON COLUMN store_timekeeping_settings.min_rest_minutes IS
  'Giờ nghỉ tối thiểu giữa hai ca (phút), mặc định 720 = 12 giờ';

COMMIT;
