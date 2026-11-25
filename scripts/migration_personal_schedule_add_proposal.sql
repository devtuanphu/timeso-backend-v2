-- Thêm loại lịch cá nhân "đề xuất giờ" (PROPOSAL) vào bảng
-- employee_personal_schedules. PROPOSAL = khung giờ nhân viên mong muốn được
-- làm việc; chủ nhận thông báo, xem được như một loại lịch, và khi xếp ca thì
-- PROPOSAL được tính như lịch trống (không cảnh báo "Ngoài lịch trống").
-- Luật ở src/modules/stores/personal-schedule.utils.ts.
--
-- Chỉ nới rộng CHECK chk_employee_personal_schedules_values: thêm 'PROPOSAL'
-- vào tập giá trị hợp lệ của cột kind, giữ nguyên các phần còn lại. Mọi hàng
-- cũ đều vẫn hợp lệ.
--
-- An toàn khi bảng lớn: tách làm HAI giao dịch.
--   TX1: DROP ... IF EXISTS + ADD ... NOT VALID — chỉ khoá ngắn để sửa catalog,
--        KHÔNG quét toàn bảng (NOT VALID bỏ kiểm các hàng cũ); hàng mới vẫn bị
--        CHECK ngay.
--   TX2: VALIDATE CONSTRAINT — quét kiểm các hàng cũ dưới khoá SHARE UPDATE
--        EXCLUSIVE (không chặn đọc/ghi thường).
-- Idempotent: chạy lại nhiều lần vẫn an toàn (DROP IF EXISTS rồi ADD lại cùng
-- tên; VALIDATE trên constraint đã hợp lệ là no-op). Giữ lock_timeout.
--
-- Thứ tự: chạy TRƯỚC khi deploy backend chấp nhận kind='PROPOSAL'.
-- Run: scripts/migrate.sh apply migration_personal_schedule_add_proposal.sql

\set ON_ERROR_STOP on

-- TX1: nới CHECK, chưa quét bảng.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE employee_personal_schedules
  DROP CONSTRAINT IF EXISTS chk_employee_personal_schedules_values;

ALTER TABLE employee_personal_schedules
  ADD CONSTRAINT chk_employee_personal_schedules_values CHECK (
    kind IN ('AVAILABLE', 'BUSY', 'STUDY', 'PROPOSAL')
    AND repeat IN ('NONE', 'WEEKLY', 'MONTHLY')
    AND jsonb_typeof(slots) = 'array'
    AND jsonb_array_length(slots) BETWEEN 1 AND 50
  ) NOT VALID;

COMMIT;

-- TX2: quét kiểm các hàng cũ (no-op nếu đã hợp lệ).
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE employee_personal_schedules
  VALIDATE CONSTRAINT chk_employee_personal_schedules_values;

COMMIT;
