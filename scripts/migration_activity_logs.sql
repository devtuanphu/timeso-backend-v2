-- X1 "Lịch sử thao tác": append-only log of business actions per store.
--
-- Additive and idempotent: safe to run more than once. Apply by hand with psql
-- BEFORE deploying the build that writes to it (DATABASE_SCHEMA_MODE=managed,
-- synchronize=false). No backfill: the log starts at go-live.
--
-- params holds only non-sensitive display data (shift names, HH:mm times,
-- dates, statuses, counts). Never money amounts, face/location data, free-text
-- reasons or identity numbers.

BEGIN;

CREATE TABLE IF NOT EXISTS activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- No FK on store/actor/subject. A store FK would make every log insert
  -- take FOR KEY SHARE on the stores row, so a check-in writing its log
  -- entry would wait behind any transaction holding stores FOR UPDATE
  -- (schedule creation, custom-shift approval). The writer resolves the store
  -- with a SELECT; the log also outlives a hard-deleted profile.
  store_id uuid NOT NULL,
  actor_account_id uuid,
  actor_role varchar(16) NOT NULL,
  subject_employee_profile_id uuid,
  action varchar(64) NOT NULL,
  resource_type varchar(32) NOT NULL,
  resource_id uuid,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key varchar(200),
  CONSTRAINT ck_activity_logs_actor_role
    CHECK (actor_role IN ('owner', 'staff', 'system'))
);

-- Environments that ran an earlier version of this script got a store FK:
-- drop it (the column and indexes stay).
DO $$
DECLARE
  fk record;
BEGIN
  FOR fk IN
    SELECT constraint_row.conname
    FROM pg_constraint constraint_row
    WHERE constraint_row.conrelid = to_regclass('activity_logs')
      AND constraint_row.contype = 'f'
      AND constraint_row.confrelid = to_regclass('stores')
  LOOP
    EXECUTE format('ALTER TABLE activity_logs DROP CONSTRAINT %I', fk.conname);
  END LOOP;
END $$;

-- A plain UNIQUE constraint (NULLs never conflict) so the writer can use
-- ON CONFLICT (idempotency_key) DO NOTHING.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_activity_logs_idempotency_key'
  ) THEN
    ALTER TABLE activity_logs
      ADD CONSTRAINT uq_activity_logs_idempotency_key UNIQUE (idempotency_key);
  END IF;
END $$;

-- Store-wide feed (owner), per-employee feed (subject) and own actions
-- (actor), each read newest first with keyset pagination on (occurred_at, id).
CREATE INDEX IF NOT EXISTS idx_activity_logs_store_occurred
  ON activity_logs (store_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_subject_occurred
  ON activity_logs (subject_employee_profile_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_actor_occurred
  ON activity_logs (actor_account_id, occurred_at DESC, id DESC);

COMMIT;

-- Verify:
--   SELECT count(*) FROM activity_logs;
--   \d activity_logs
