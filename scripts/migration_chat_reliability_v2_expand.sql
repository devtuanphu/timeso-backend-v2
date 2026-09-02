-- Expand phase. Apply only after the preflight passes and a backup/forward-fix plan exists.
ALTER TABLE chat_groups
  ADD COLUMN IF NOT EXISTS next_message_sequence bigint;

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS sequence bigint,
  ADD COLUMN IF NOT EXISTS client_message_id uuid;

ALTER TABLE chat_group_members
  ADD COLUMN IF NOT EXISTS last_read_sequence bigint;

CREATE TABLE IF NOT EXISTS chat_message_sequence_backfill_progress (
  group_id uuid PRIMARY KEY REFERENCES chat_groups(id) ON DELETE CASCADE,
  frozen_count bigint NOT NULL CHECK (frozen_count >= 0),
  assigned_count bigint NOT NULL DEFAULT 0 CHECK (assigned_count >= 0),
  next_backfill_sequence bigint NOT NULL CHECK (next_backfill_sequence > 0),
  read_cursor_backfilled boolean NOT NULL DEFAULT false,
  prepared_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type varchar(32) NOT NULL,
  group_id uuid NOT NULL REFERENCES chat_groups(id),
  message_id uuid REFERENCES chat_messages(id),
  actor_account_id uuid REFERENCES accounts(id),
  sequence bigint,
  status varchar(16) NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  published_at timestamptz,
  dead_at timestamptz,
  error_code varchar(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT ck_chat_outbox_event_identity CHECK (
    (event_type = 'MESSAGE_CREATED_V1' AND message_id IS NOT NULL AND actor_account_id IS NOT NULL AND sequence IS NOT NULL)
    OR
    (event_type = 'READ_UPDATED_V1' AND message_id IS NULL AND actor_account_id IS NOT NULL AND sequence IS NOT NULL)
  ),
  CONSTRAINT ck_chat_outbox_status CHECK (status IN ('pending', 'processing', 'published', 'dead')),
  CONSTRAINT ck_chat_outbox_event_type CHECK (event_type IN ('MESSAGE_CREATED_V1', 'READ_UPDATED_V1'))
);

-- Large-table indexes are intentionally not built in this transaction. After
-- expand commits, run migration_chat_reliability_v2_indexes.sql as an operator
-- step so each index uses CREATE INDEX CONCURRENTLY and is independently
-- retryable without holding write locks for the entire expand phase.

CREATE OR REPLACE FUNCTION chat_prepare_message_sequence(p_group_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_next bigint;
  v_null_count bigint;
  v_max bigint;
BEGIN
  SELECT next_message_sequence INTO v_next
  FROM chat_groups WHERE id = p_group_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'chat group does not exist';
  END IF;
  IF v_next IS NOT NULL THEN RETURN; END IF;

  SELECT COUNT(*) FILTER (WHERE sequence IS NULL), COALESCE(MAX(sequence), 0)
    INTO v_null_count, v_max
  FROM chat_messages
  WHERE group_id = p_group_id; -- deliberately includes soft-deleted rows

  INSERT INTO chat_message_sequence_backfill_progress(
    group_id, frozen_count, assigned_count, next_backfill_sequence
  ) VALUES (p_group_id, v_null_count, 0, v_max + 1)
  ON CONFLICT (group_id) DO NOTHING;

  UPDATE chat_groups
  SET next_message_sequence = v_max + v_null_count + 1
  WHERE id = p_group_id AND next_message_sequence IS NULL;
END $$;

CREATE OR REPLACE FUNCTION chat_assign_message_sequence()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.sequence IS NOT NULL THEN RETURN NEW; END IF;
  PERFORM chat_prepare_message_sequence(NEW.group_id);
  UPDATE chat_groups
  SET next_message_sequence = next_message_sequence + 1
  WHERE id = NEW.group_id
  RETURNING next_message_sequence - 1 INTO NEW.sequence;
  IF NEW.sequence IS NULL THEN
    RAISE EXCEPTION 'chat sequence allocation failed';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_chat_assign_message_sequence ON chat_messages;
CREATE TRIGGER trg_chat_assign_message_sequence
BEFORE INSERT ON chat_messages
FOR EACH ROW EXECUTE FUNCTION chat_assign_message_sequence();

-- Do not freeze every group in this migration transaction. The trigger above
-- safely initializes an individual group on its first live insert. Operators
-- must run migration_chat_reliability_v2_freeze_driver.sql repeatedly in psql;
-- it executes one group per autocommit transaction with bounded lock/statement
-- timeouts and can be restarted after any busy group.
