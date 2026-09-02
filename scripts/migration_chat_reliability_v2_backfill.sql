-- Install resumable bounded backfill functions. Invoke one group at a time with batch 1..1000.
CREATE OR REPLACE FUNCTION chat_backfill_message_sequence_batch(
  p_group_id uuid,
  p_batch_size integer DEFAULT 500
) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  v_start bigint;
  v_frozen bigint;
  v_assigned bigint;
  v_updated integer;
BEGIN
  IF p_batch_size < 1 OR p_batch_size > 1000 THEN
    RAISE EXCEPTION 'batch size must be between 1 and 1000';
  END IF;

  PERFORM 1 FROM chat_groups WHERE id = p_group_id FOR UPDATE;
  PERFORM chat_prepare_message_sequence(p_group_id);
  SELECT next_backfill_sequence, frozen_count, assigned_count
    INTO v_start, v_frozen, v_assigned
  FROM chat_message_sequence_backfill_progress
  WHERE group_id = p_group_id FOR UPDATE;

  WITH batch AS (
    SELECT id, row_number() OVER (ORDER BY created_at ASC, id ASC) - 1 AS offset_value
    FROM chat_messages
    WHERE group_id = p_group_id AND sequence IS NULL
    ORDER BY created_at ASC, id ASC
    LIMIT p_batch_size
  )
  UPDATE chat_messages message
  SET sequence = v_start + batch.offset_value,
      updated_at = message.updated_at
  FROM batch WHERE message.id = batch.id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  UPDATE chat_message_sequence_backfill_progress
  SET assigned_count = assigned_count + v_updated,
      next_backfill_sequence = next_backfill_sequence + v_updated,
      updated_at = now()
  WHERE group_id = p_group_id;

  IF v_assigned + v_updated > v_frozen THEN
    RAISE EXCEPTION 'backfill exceeded frozen population';
  END IF;
  RETURN v_updated;
END $$;

CREATE OR REPLACE FUNCTION chat_backfill_read_cursor(p_group_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM chat_messages WHERE group_id = p_group_id AND sequence IS NULL
  ) THEN
    RAISE EXCEPTION 'message sequence backfill is incomplete';
  END IF;

  UPDATE chat_group_members member
  SET last_read_sequence = CASE
    WHEN member.last_read_at IS NULL THEN NULL
    ELSE COALESCE((
      SELECT MAX(message.sequence)
      FROM chat_messages message
      WHERE message.group_id = member.group_id
        AND message.created_at <= member.last_read_at
    ), 0)
  END
  WHERE member.group_id = p_group_id;

  UPDATE chat_message_sequence_backfill_progress
  SET read_cursor_backfilled = true, updated_at = now()
  WHERE group_id = p_group_id;
END $$;

-- Example operator loop (do not run against a shared target without approval):
-- SELECT chat_backfill_message_sequence_batch('<group uuid>', 500);
-- Repeat until it returns 0, then: SELECT chat_backfill_read_cursor('<group uuid>');

