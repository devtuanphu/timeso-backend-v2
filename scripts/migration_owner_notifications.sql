-- X6 owner notifications: per-owner switches and a dedup log.
--
-- Additive and idempotent: safe to run more than once. Apply by hand with psql
-- BEFORE deploying the build that reads these tables
-- (DATABASE_SCHEMA_MODE=managed, synchronize=false). No notification enum
-- change: owner notifications use type 'Hệ thống' + metadata.type.

BEGIN;

-- No row = every switch on, pre-shift lead time 30 minutes.
CREATE TABLE IF NOT EXISTS owner_notification_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  owner_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  pre_shift_enabled boolean NOT NULL DEFAULT true,
  pre_shift_minutes smallint NOT NULL DEFAULT 30,
  check_in_enabled boolean NOT NULL DEFAULT true,
  check_out_enabled boolean NOT NULL DEFAULT true,
  shift_ending_enabled boolean NOT NULL DEFAULT true,
  late_early_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_owner_notification_settings_store_owner
    UNIQUE (store_id, owner_account_id),
  CONSTRAINT ck_owner_notification_settings_pre_shift_minutes
    CHECK (pre_shift_minutes IN (15, 30))
);

-- One row per owner notification actually sent. The unique key makes a
-- retried job, a duplicate check-in or two app instances race-safe.
CREATE TABLE IF NOT EXISTS owner_notification_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dedup_key varchar(200) NOT NULL,
  store_id uuid NOT NULL,
  owner_account_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_owner_notification_log_dedup_key UNIQUE (dedup_key)
);

-- Housekeeping reads (optional pruning of old rows by age).
CREATE INDEX IF NOT EXISTS idx_owner_notification_log_created
  ON owner_notification_log (created_at);

COMMIT;

-- Verify:
--   \d owner_notification_settings
--   \d owner_notification_log
