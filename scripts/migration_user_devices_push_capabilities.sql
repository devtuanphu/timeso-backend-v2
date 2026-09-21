-- Khả năng push của từng bản app đã đăng ký thiết bị (vd. 'shift-alert-channels'
-- = bản staff đã tạo kênh Android shift-alerts / shift-alerts-quiet).
-- Backend dùng nó để gửi push nhắc ca vào kênh 'default' cho bản app cũ chưa có
-- kênh mới (tránh rơi vào kênh dự phòng không rung của hệ điều hành).
-- Additive, chạy lại an toàn. Chạy TRƯỚC khi deploy code có cột
-- UserDevice.pushCapabilities (TypeORM đọc cột này ở mọi truy vấn user_devices).
-- Không cần backfill: NULL = bản app cũ (không có khả năng), app mới tự gửi khi
-- đăng ký lại thiết bị.
-- Rollback: code cũ bỏ qua cột này; không cần xoá.
\set ON_ERROR_STOP on
SET lock_timeout = '3s';
ALTER TABLE user_devices ADD COLUMN IF NOT EXISTS push_capabilities text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = to_regclass('user_devices')
      AND attname = 'push_capabilities'
      AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'user_devices.push_capabilities missing after migration';
  END IF;
END $$;
