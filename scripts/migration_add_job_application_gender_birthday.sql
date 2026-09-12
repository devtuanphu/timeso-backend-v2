-- =============================================
-- Giới tính + ngày sinh trên đơn ứng tuyển
-- =============================================
-- Bổ sung hai trường nhận dạng mà form ứng tuyển bên app nhân viên thu thập.
--
-- Đặt tên trùng với `accounts.gender` / `accounts.birthday` để lúc chủ cửa
-- hàng nhận vào làm việc có thể chép thẳng sang tài khoản mà không cần lớp
-- chuyển đổi. Cả hai đều nullable: đơn đã gửi trước khi có form mới, và đơn
-- đã bị quét rà soát xoá dữ liệu cá nhân, đều không có giá trị.
--
-- Bọc trong transaction và idempotent, giống migration tạo bảng gốc — ở đây
-- không có CREATE INDEX CONCURRENTLY nên chạy trong transaction được.

BEGIN;

ALTER TABLE store_job_applications
  ADD COLUMN IF NOT EXISTS gender text,
  ADD COLUMN IF NOT EXISTS birthday date;

COMMIT;

-- =============================================
-- Kiểm tra
-- =============================================
-- SELECT column_name, data_type
--   FROM information_schema.columns
--  WHERE table_name = 'store_job_applications'
--    AND column_name IN ('gender', 'birthday');

-- =============================================
-- Rollback
-- =============================================
-- BEGIN;
-- ALTER TABLE store_job_applications
--   DROP COLUMN IF EXISTS gender,
--   DROP COLUMN IF EXISTS birthday;
-- COMMIT;
