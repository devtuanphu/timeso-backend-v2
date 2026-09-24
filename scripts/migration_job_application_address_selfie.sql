-- =============================================
-- Địa chỉ + ảnh chân dung trên đơn ứng tuyển
-- =============================================
-- CHẠY TRƯỚC KHI DEPLOY CODE. Entity `JobApplication` đã khai báo hai cột này,
-- nên bản build mới sẽ lỗi khi đọc/ghi `store_job_applications` nếu cột chưa
-- tồn tại. Bản build cũ bỏ qua cột thừa, nên chạy trước là an toàn.
--
--   address      varchar(255) NULL  — địa chỉ một dòng người ứng tuyển nhập.
--   selfie_path  varchar(255) NULL  — CHỈ tên file (vd. `<uuid>.jpg`), không
--                                     bao giờ là đường dẫn. File nằm trong
--                                     ./uploads-private/job-application-selfies/
--                                     (không public), đọc qua route có kiểm quyền.
--
-- Cả hai nullable: đơn cũ không có, và bị xoá khi thu hồi / quét lưu trữ.
-- Idempotent (ADD COLUMN IF NOT EXISTS), không backfill, không khoá lâu:
-- thêm cột nullable không default chỉ sửa metadata.

BEGIN;

ALTER TABLE store_job_applications
  ADD COLUMN IF NOT EXISTS address varchar(255),
  ADD COLUMN IF NOT EXISTS selfie_path varchar(255);

COMMIT;

-- =============================================
-- Kiểm tra (mong đợi 2 dòng, character varying, 255, YES)
-- =============================================
-- SELECT column_name, data_type, character_maximum_length, is_nullable
--   FROM information_schema.columns
--  WHERE table_name = 'store_job_applications'
--    AND column_name IN ('address', 'selfie_path')
--  ORDER BY column_name;

-- =============================================
-- Rollback (chỉ sau khi đã rollback code; mất dữ liệu 2 cột; file ảnh trong
-- ./uploads-private/job-application-selfies/ phải xoá riêng)
-- =============================================
-- BEGIN;
-- ALTER TABLE store_job_applications
--   DROP COLUMN IF EXISTS address,
--   DROP COLUMN IF EXISTS selfie_path;
-- COMMIT;
