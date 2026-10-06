-- Note 9:
--   * "Xin nghỉ đột xuất" gets its own leave type (was saved as PERSONAL).
--   * Store opening hours, for the schedule preview's staffing gaps.
--   * "Xoá hộp thoại": a per-member mark hiding older chat messages.
--
-- Order: run BEFORE deploying the backend that reads these columns (TypeORM
-- selects every mapped column). Additive and safe to re-run; the old backend
-- ignores them.
--
-- Run: psql ... -v ON_ERROR_STOP=1 -f scripts/migration_note9.sql

\set ON_ERROR_STOP on

-- ALTER TYPE ... ADD VALUE cannot share a transaction with statements using
-- the new value; it runs on its own.
ALTER TYPE employee_leave_requests_type_enum ADD VALUE IF NOT EXISTS 'SUDDEN';

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE store_shift_configs
  ADD COLUMN IF NOT EXISTS open_time time NOT NULL DEFAULT '06:00:00';
ALTER TABLE store_shift_configs
  ADD COLUMN IF NOT EXISTS close_time time NOT NULL DEFAULT '22:00:00';

ALTER TABLE chat_group_members
  ADD COLUMN IF NOT EXISTS cleared_sequence bigint;

COMMIT;

-- Verify
SELECT enum_range(NULL::employee_leave_requests_type_enum);
SELECT column_name, data_type, column_default
  FROM information_schema.columns
 WHERE (table_name = 'store_shift_configs' AND column_name IN ('open_time', 'close_time'))
    OR (table_name = 'chat_group_members' AND column_name = 'cleared_sequence');
