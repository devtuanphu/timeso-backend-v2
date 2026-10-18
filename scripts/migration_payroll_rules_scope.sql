-- Thiết lập tính lương: phạm vi áp dụng của từng khoản thưởng / vi phạm, và
-- ảnh chụp các khoản đã báo cho nhân viên (để báo ngay mỗi khi một khoản đổi).
--
-- store_payroll_rules.employee_profile_ids: NULL (hoặc rỗng) = toàn cửa hàng;
-- có danh sách = chỉ những nhân viên đó (cùng mức của khoản).
--
-- employee_salaries.adjustment_snapshot: {khoá dòng: số tiền} của các dòng
-- thưởng / vi phạm lần tính gần nhất. Dòng cũ để NULL = chưa có mốc (lần tính
-- đầu chỉ ghi mốc, không báo, để không dội cả tháng thông báo lúc triển khai);
-- dòng mới mặc định '{}' = báo ngay từ khoản đầu tiên.
--
-- Order: run BEFORE deploying the backend that reads the new columns.
-- Safe to re-run. Additive only.
--
-- Run: scripts/migrate.sh apply migration_payroll_rules_scope.sql

\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE store_payroll_rules ADD COLUMN IF NOT EXISTS employee_profile_ids uuid[];

ALTER TABLE employee_salaries ADD COLUMN IF NOT EXISTS adjustment_snapshot jsonb;
ALTER TABLE employee_salaries ALTER COLUMN adjustment_snapshot SET DEFAULT '{}'::jsonb;

COMMIT;
