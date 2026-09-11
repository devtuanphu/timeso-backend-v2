-- Additive expand migration. Apply before enabling CHAT_PUSH_DELIVERY_ENABLED.
-- Existing tokens intentionally remain unenrolled (fingerprint NULL) until their
-- owning app authenticates and registers again.
--
-- This file requires psql autocommit. Concurrent index phases must never be wrapped
-- in an application-managed transaction.
\set ON_ERROR_STOP on
\set AUTOCOMMIT on
SET lock_timeout = '3s';
SET statement_timeout = '10min';

ALTER TABLE user_devices
  ADD COLUMN IF NOT EXISTS push_token_fingerprint char(64),
  ADD COLUMN IF NOT EXISTS registration_version bigint NOT NULL DEFAULT 0;

-- migration-phase: active-device-index
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ux_user_devices_active_push_fingerprint
  ON user_devices(push_token_fingerprint)
  WHERE push_token_fingerprint IS NOT NULL
    AND is_active = true AND deleted_at IS NULL;

-- migration-phase: outbox-columns-and-constraints
ALTER TABLE chat_outbox_events
  ADD COLUMN IF NOT EXISTS push_intent_status varchar(16),
  ADD COLUMN IF NOT EXISTS push_intent_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS push_intent_available_at timestamptz,
  ADD COLUMN IF NOT EXISTS push_intent_locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS push_intent_claim_token uuid,
  ADD COLUMN IF NOT EXISTS push_intent_error_code varchar(64);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint constraint_row
    JOIN pg_class table_row ON table_row.oid = constraint_row.conrelid
    JOIN pg_namespace schema_row ON schema_row.oid = table_row.relnamespace
    WHERE schema_row.nspname = current_schema()
      AND table_row.relname = 'chat_outbox_events'
      AND constraint_row.conname = 'ck_chat_outbox_push_intent_status'
  ) THEN
    ALTER TABLE chat_outbox_events ADD CONSTRAINT ck_chat_outbox_push_intent_status
      CHECK (push_intent_status IS NULL OR push_intent_status IN ('pending', 'processing', 'completed', 'dead'))
      NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint constraint_row
    JOIN pg_class table_row ON table_row.oid = constraint_row.conrelid
    JOIN pg_namespace schema_row ON schema_row.oid = table_row.relnamespace
    WHERE schema_row.nspname = current_schema()
      AND table_row.relname = 'chat_outbox_events'
      AND constraint_row.conname = 'ck_chat_outbox_push_intent_attempts'
  ) THEN
    ALTER TABLE chat_outbox_events ADD CONSTRAINT ck_chat_outbox_push_intent_attempts
      CHECK (push_intent_attempt_count >= 0) NOT VALID;
  END IF;
END $$;

ALTER TABLE chat_outbox_events
  VALIDATE CONSTRAINT ck_chat_outbox_push_intent_status;
ALTER TABLE chat_outbox_events
  VALIDATE CONSTRAINT ck_chat_outbox_push_intent_attempts;

-- migration-phase: outbox-dispatch-index
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_chat_outbox_push_intent_dispatch
  ON chat_outbox_events(push_intent_status, push_intent_available_at, created_at)
  WHERE push_intent_status IN ('pending', 'processing') AND deleted_at IS NULL;

-- migration-phase: outbox-lease-index
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_chat_outbox_push_intent_lease
  ON chat_outbox_events(push_intent_locked_at)
  WHERE push_intent_status = 'processing' AND deleted_at IS NULL;

-- migration-phase: new-delivery-ledger
CREATE TABLE IF NOT EXISTS chat_push_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES chat_messages(id) ON DELETE RESTRICT,
  group_id uuid NOT NULL REFERENCES chat_groups(id) ON DELETE RESTRICT,
  intended_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  user_device_id uuid NOT NULL REFERENCES user_devices(id) ON DELETE RESTRICT,
  expected_device_id varchar(255) NOT NULL,
  expected_token_fingerprint char(64) NOT NULL,
  expected_registration_version bigint NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  receipt_attempt_count integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  claim_token uuid,
  expo_ticket_id varchar(255),
  ticket_accepted_at timestamptz,
  receipt_available_at timestamptz,
  delivered_at timestamptz,
  suppressed_at timestamptz,
  dead_at timestamptz,
  error_code varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT ck_chat_push_delivery_status CHECK (
    status IN ('pending', 'processing', 'ticket_accepted', 'delivered', 'suppressed', 'dead')
  ),
  CONSTRAINT ck_chat_push_delivery_attempts CHECK (
    attempt_count >= 0 AND receipt_attempt_count >= 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_chat_push_delivery_message_device
  ON chat_push_deliveries(message_id, user_device_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_chat_push_delivery_message_token
  ON chat_push_deliveries(message_id, expected_token_fingerprint);
CREATE INDEX IF NOT EXISTS ix_chat_push_delivery_dispatch
  ON chat_push_deliveries(status, available_at, created_at)
  WHERE status IN ('pending', 'processing') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_chat_push_delivery_receipt
  ON chat_push_deliveries(status, receipt_available_at)
  WHERE status = 'ticket_accepted' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_chat_push_delivery_lease
  ON chat_push_deliveries(locked_at)
  WHERE status = 'processing' AND deleted_at IS NULL;
