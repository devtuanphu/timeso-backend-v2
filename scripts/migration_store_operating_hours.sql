-- "Giờ hoạt động cửa hàng" nhiều khung giờ (app chủ → Ca làm việc → trang
-- Ngày → ô giờ hoạt động), vd [{"start":"12:00","end":"24:00"},
-- {"start":"00:00","end":"05:00"}]. Không khung nào qua nửa đêm.
--
-- NULL = chưa lưu khung giờ: backend trả khung giờ suy ra từ open_time /
-- close_time (qua đêm thì tách hai khung). Lưu khung giờ thì open_time /
-- close_time được tính lại theo, nên màn cũ đọc cặp này vẫn đúng. Không
-- backfill.
--
-- Thứ tự: chạy TRƯỚC khi deploy backend (entity đọc cột này). Chỉ thêm cột
-- NULL, chạy lại được.
--
-- Run: scripts/migrate.sh apply migration_store_operating_hours.sql

\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE store_shift_configs
  ADD COLUMN IF NOT EXISTS operating_hours jsonb;

COMMENT ON COLUMN store_shift_configs.operating_hours IS
  'Giờ hoạt động: [{start: HH:mm, end: HH:mm ≤ 24:00}], NULL = theo open_time/close_time';

COMMIT;
