-- "Cho phép về sớm [phút]" tách khỏi "Cho phép đi muộn [phút]" (app chủ →
-- Thiết lập ca làm & chấm công → Quy định đi muộn/ về sớm). Trước đây một số
-- allowed_late_minutes áp cho cả hai.
--
-- NULL = cửa hàng chưa đặt riêng: backend dùng allowed_late_minutes cho về sớm,
-- nên cửa hàng cũ chấm công y như trước. Không backfill.
--
-- Thứ tự: chạy TRƯỚC khi deploy backend (entity đọc cột này ở mọi lần tải
-- thiết lập chấm công). Chỉ thêm cột NULL, chạy lại được.
--
-- Run: scripts/migrate.sh apply migration_allowed_early_leave_minutes.sql

\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE store_timekeeping_settings
  ADD COLUMN IF NOT EXISTS allowed_early_leave_minutes integer;

COMMENT ON COLUMN store_timekeeping_settings.allowed_early_leave_minutes IS
  'Cho phép về sớm tối đa (phút); NULL = theo allowed_late_minutes';

COMMIT;
