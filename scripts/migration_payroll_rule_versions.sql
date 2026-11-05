-- Khoản thưởng / vi phạm có hiệu lực theo thời gian: chủ sửa (hoặc xoá) một
-- khoản thì cách tính mới chỉ áp dụng từ ngày sửa trở đi; những lần phát sinh
-- trước đó vẫn tính theo cách cũ. Trước đây khoản được sửa tại chỗ và mọi lần
-- tính lại (lưu thiết lập, mở màn lương, cron đầu tháng) dùng cách tính mới
-- cho cả tháng.
--
-- Mỗi lần sửa phần ảnh hưởng tiền (mức, cách tính, mốc, phạm vi, bật/tắt):
--   * dòng cũ: valid_to = ngày sửa (giờ VN, không gồm ngày đó) + xoá mềm,
--     để mọi màn thiết lập chỉ thấy dòng hiện hành như cũ;
--   * dòng mới: lineage_id = dòng gốc, valid_from = ngày sửa.
-- Khoản thêm mới: valid_from = ngày thêm. Xoá: valid_to = ngày xoá + xoá mềm.
-- Dòng có sẵn: lineage_id / valid_from / valid_to đều NULL = hiệu lực mọi
-- ngày — tính y như trước, không đổi số liệu cũ.
-- Tính lương (payroll-calculation.utils.ts ruleRawLines): mỗi lần phát sinh
-- theo phiên bản có hiệu lực vào ngày làm của nó; khoản tính theo cả tháng
-- (mốc, % lương tháng…) theo phiên bản có hiệu lực cuối tháng.
--
-- Order: run BEFORE deploying the backend that reads the new columns (TypeORM
-- selects every mapped column). Safe to re-run. Additive only.
--
-- Run: scripts/migrate.sh apply migration_payroll_rule_versions.sql

\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE store_payroll_rules
  ADD COLUMN IF NOT EXISTS lineage_id uuid,
  ADD COLUMN IF NOT EXISTS valid_from date,
  ADD COLUMN IF NOT EXISTS valid_to date;

COMMENT ON COLUMN store_payroll_rules.lineage_id IS
  'Dòng gốc của khoản (NULL = chính dòng này); các phiên bản cùng lineage là một khoản';
COMMENT ON COLUMN store_payroll_rules.valid_from IS
  'Ngày (giờ VN) bắt đầu áp dụng phiên bản này; NULL = từ trước tới nay';
COMMENT ON COLUMN store_payroll_rules.valid_to IS
  'Ngày (giờ VN) phiên bản này hết áp dụng, không gồm ngày đó; NULL = đang áp dụng';

-- Tính lương nạp cả phiên bản đã hết hạn trong tháng (xoá mềm có valid_to).
CREATE INDEX IF NOT EXISTS idx_store_payroll_rules_store_valid_to
  ON store_payroll_rules (store_id, valid_to)
  WHERE valid_to IS NOT NULL;

COMMIT;
