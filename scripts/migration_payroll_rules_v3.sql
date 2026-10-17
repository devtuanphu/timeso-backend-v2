-- Thiết lập tính lương v3: cách tính chi tiết của từng khoản thưởng / vi phạm
-- (Figma "Chọn cách tính": cố định, theo đơn giá, theo hệ số lương, theo phần
-- trăm, theo khối lương, luỹ tiến, bậc thang, theo mốc điều kiện), lưu ở
-- store_payroll_rules.calc_config (jsonb). Xem payroll-rule-config.utils.ts.
--
-- Dòng có calc_config: tiền tính theo calc_config. calc_mode / value /
-- threshold vẫn được ghi một cách tính gần đúng để app cũ (v2) hiển thị được.
-- Dòng không có calc_config: như trước (v2 theo calc_mode, cũ theo rule_type).
--
-- Order: run BEFORE deploying the backend that reads the new column.
-- Safe to re-run. Additive only.
--
-- Run: scripts/migrate.sh apply migration_payroll_rules_v3.sql

\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE store_payroll_rules ADD COLUMN IF NOT EXISTS calc_config jsonb;

COMMIT;
