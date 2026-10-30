-- Lịch cá nhân của nhân viên (app nhân viên → Thông tin cá nhân → Lịch):
-- lịch trống (có thể nhận ca), lịch bận, lịch học. Nhân viên tự nhập; chủ chỉ
-- xem, và được cảnh báo khi xếp ca trùng lịch bận / lịch học hoặc ngoài lịch
-- trống. Không chặn đăng ký hay xếp ca.
--
-- Một dòng = một lần "Lưu lịch": nhiều khung giờ (slots, mỗi khung gắn một
-- ngày), một kiểu lặp, một ghi chú. Khung giờ có giờ kết thúc <= giờ bắt đầu
-- là khung qua đêm (kết thúc ngày hôm sau), cùng quy ước ca làm.
-- Luật ở src/modules/stores/personal-schedule.utils.ts.
--
-- Thứ tự: chạy TRƯỚC khi deploy backend có bảng này. Chỉ tạo bảng mới, chạy lại được.
--
-- Run: scripts/migrate.sh apply migration_employee_personal_schedules.sql

\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS employee_personal_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  employee_profile_id uuid NOT NULL REFERENCES employee_profiles(id) ON DELETE CASCADE,
  kind varchar(16) NOT NULL,
  repeat varchar(16) NOT NULL DEFAULT 'NONE',
  slots jsonb NOT NULL,
  note varchar(100),
  client_request_id uuid,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT chk_employee_personal_schedules_values CHECK (
    kind IN ('AVAILABLE', 'BUSY', 'STUDY')
    AND repeat IN ('NONE', 'WEEKLY', 'MONTHLY')
    AND jsonb_typeof(slots) = 'array'
    AND jsonb_array_length(slots) BETWEEN 1 AND 50
  )
);

CREATE INDEX IF NOT EXISTS ix_employee_personal_schedules_employee
  ON employee_personal_schedules (employee_profile_id, kind, created_at);

CREATE INDEX IF NOT EXISTS ix_employee_personal_schedules_store
  ON employee_personal_schedules (store_id, employee_profile_id);

-- Bấm "Lưu" hai lần / mạng gửi lại: cùng clientRequestId trả lại bản đã tạo.
CREATE UNIQUE INDEX IF NOT EXISTS ux_employee_personal_schedules_client_request
  ON employee_personal_schedules (employee_profile_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

COMMIT;
