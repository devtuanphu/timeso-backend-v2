-- X3 chat receipts (Zalo-like): per-member "delivered" cursor next to the
-- existing read cursor, and the DELIVERED_UPDATED_V1 outbox event type.
--
-- Additive and idempotent: safe to run more than once. Apply by hand with psql
-- BEFORE deploying the build that reads chat_group_members.last_delivered_sequence
-- and chat_outbox_events.range_start_sequence
-- (TypeORM selects the column on every member load; DATABASE_SCHEMA_MODE=managed,
-- synchronize=false). Do not wrap in psql -1: ALTER TYPE ... ADD VALUE must be
-- committed before the value can be used, and the constraint swap runs in its
-- own short transaction.
--
-- Rollback (only while no DELIVERED_UPDATED_V1 row exists): redeploy the
-- previous build; the new columns are harmless to it and can stay.
\set ON_ERROR_STOP on
SET lock_timeout = '3s';

-- 1. Columns. A constant DEFAULT is metadata-only on PostgreSQL 11+ (no rewrite).
ALTER TABLE chat_group_members
  ADD COLUMN IF NOT EXISTS last_delivered_sequence bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_delivered_at timestamp NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint constraint_row
    JOIN pg_class table_row ON table_row.oid = constraint_row.conrelid
    JOIN pg_namespace schema_row ON schema_row.oid = table_row.relnamespace
    WHERE table_row.relname = 'chat_group_members'
      AND schema_row.nspname = current_schema()
      AND constraint_row.conname = 'ck_chat_group_members_delivered_nonnegative'
  ) THEN
    ALTER TABLE chat_group_members
      ADD CONSTRAINT ck_chat_group_members_delivered_nonnegative
      CHECK (last_delivered_sequence >= 0) NOT VALID;
  END IF;
END $$;
ALTER TABLE chat_group_members
  VALIDATE CONSTRAINT ck_chat_group_members_delivered_nonnegative;

-- 2. Backfill: whatever a member has read was delivered. One row per
-- membership (small table); rerun-safe because it only raises the cursor.
UPDATE chat_group_members
SET last_delivered_sequence = last_read_sequence,
    last_delivered_at = COALESCE(last_read_at, last_delivered_at)
WHERE last_read_sequence IS NOT NULL
  AND last_read_sequence > last_delivered_sequence;

-- 3. Outbox event type. The expand script created event_type as varchar with
-- CHECK constraints; a bootstrap (synchronize) database has a Postgres enum.
-- Handle both.
DO $$
DECLARE
  enum_type text;
BEGIN
  SELECT attribute_type.typname INTO enum_type
  FROM pg_attribute attribute_row
  JOIN pg_type attribute_type ON attribute_type.oid = attribute_row.atttypid
  WHERE attribute_row.attrelid = to_regclass('chat_outbox_events')
    AND attribute_row.attname = 'event_type'
    AND attribute_type.typtype = 'e';
  IF enum_type IS NOT NULL THEN
    EXECUTE format(
      'ALTER TYPE %I ADD VALUE IF NOT EXISTS %L',
      enum_type,
      'DELIVERED_UPDATED_V1'
    );
  END IF;
END $$;

-- Delivered range start (dispatcher targets only senders in the range).
ALTER TABLE chat_outbox_events
  ADD COLUMN IF NOT EXISTS range_start_sequence bigint NULL;

-- Swap the constraints NOT VALID (brief ACCESS EXCLUSIVE, no table scan),
-- then validate separately under SHARE UPDATE EXCLUSIVE so dispatcher and
-- sender writes keep flowing while existing rows are checked.
BEGIN;
ALTER TABLE chat_outbox_events
  DROP CONSTRAINT IF EXISTS ck_chat_outbox_event_type;
ALTER TABLE chat_outbox_events
  ADD CONSTRAINT ck_chat_outbox_event_type
  CHECK (event_type::text IN ('MESSAGE_CREATED_V1', 'READ_UPDATED_V1', 'DELIVERED_UPDATED_V1'))
  NOT VALID;
ALTER TABLE chat_outbox_events
  DROP CONSTRAINT IF EXISTS ck_chat_outbox_event_identity;
ALTER TABLE chat_outbox_events
  ADD CONSTRAINT ck_chat_outbox_event_identity CHECK (
    (event_type::text = 'MESSAGE_CREATED_V1' AND message_id IS NOT NULL AND actor_account_id IS NOT NULL AND sequence IS NOT NULL)
    OR
    (event_type::text IN ('READ_UPDATED_V1', 'DELIVERED_UPDATED_V1') AND message_id IS NULL AND actor_account_id IS NOT NULL AND sequence IS NOT NULL)
  ) NOT VALID;
COMMIT;

ALTER TABLE chat_outbox_events
  VALIDATE CONSTRAINT ck_chat_outbox_event_type;
ALTER TABLE chat_outbox_events
  VALIDATE CONSTRAINT ck_chat_outbox_event_identity;

-- Verify.
SELECT
  (SELECT COUNT(*) FROM chat_group_members
    WHERE last_read_sequence IS NOT NULL
      AND last_delivered_sequence < last_read_sequence) AS delivered_below_read,
  (SELECT COUNT(*) FROM pg_constraint
    WHERE conname IN ('ck_chat_outbox_event_type', 'ck_chat_outbox_event_identity')
      AND pg_get_constraintdef(oid) LIKE '%DELIVERED_UPDATED_V1%') AS outbox_constraints_updated;
