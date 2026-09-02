DO $$
BEGIN
  IF EXISTS (
    SELECT required.name
    FROM (VALUES
      ('ux_chat_group_message_sequence'),
      ('ux_chat_message_client_idempotency'),
      ('ux_chat_group_member_active'),
      ('ix_chat_group_member_account_active'),
      ('ux_chat_outbox_message_created'),
      ('ix_chat_outbox_dispatch'),
      ('ix_chat_outbox_lease'),
      ('ix_chat_outbox_group_sequence'),
      ('ix_chat_outbox_cleanup_published'),
      ('ix_chat_outbox_cleanup_dead')
    ) AS required(name)
    LEFT JOIN pg_class index_class ON index_class.relname = required.name
    LEFT JOIN pg_index index_state ON index_state.indexrelid = index_class.oid
    WHERE index_state.indexrelid IS NULL OR index_state.indisvalid = false
  ) THEN
    RAISE EXCEPTION 'chat verify: required concurrent indexes missing or invalid';
  END IF;
  IF EXISTS (SELECT 1 FROM chat_messages WHERE sequence IS NULL) THEN
    RAISE EXCEPTION 'chat verify: null message sequences remain';
  END IF;
  IF EXISTS (
    SELECT 1 FROM chat_messages
    GROUP BY group_id, sequence HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'chat verify: duplicate sequence including soft-deleted rows';
  END IF;
  IF EXISTS (
    SELECT 1 FROM chat_groups g
    WHERE g.next_message_sequence IS NULL
       OR g.next_message_sequence <= COALESCE((
         SELECT MAX(m.sequence) FROM chat_messages m WHERE m.group_id = g.id
       ), 0)
  ) THEN
    RAISE EXCEPTION 'chat verify: invalid next sequence';
  END IF;
  IF EXISTS (
    SELECT 1 FROM chat_group_members m
    WHERE m.last_read_sequence < 0
       OR m.last_read_sequence > COALESCE((
         SELECT MAX(message.sequence) FROM chat_messages message WHERE message.group_id = m.group_id
       ), 0)
  ) THEN
    RAISE EXCEPTION 'chat verify: invalid read cursor';
  END IF;
  IF EXISTS (
    SELECT 1 FROM chat_message_sequence_backfill_progress
    WHERE assigned_count <> frozen_count OR read_cursor_backfilled = false
  ) THEN
    RAISE EXCEPTION 'chat verify: backfill progress incomplete';
  END IF;
  IF EXISTS (
    SELECT 1 FROM chat_outbox_events
    WHERE NOT (
      (event_type = 'MESSAGE_CREATED_V1' AND message_id IS NOT NULL AND actor_account_id IS NOT NULL AND sequence IS NOT NULL)
      OR (event_type = 'READ_UPDATED_V1' AND message_id IS NULL AND actor_account_id IS NOT NULL AND sequence IS NOT NULL)
    )
  ) THEN
    RAISE EXCEPTION 'chat verify: invalid outbox identity';
  END IF;
END $$;

SELECT COUNT(*) AS chat_groups,
       COUNT(*) FILTER (WHERE next_message_sequence IS NULL) AS groups_without_next_sequence
FROM chat_groups;
SELECT COUNT(*) AS chat_messages,
       COUNT(*) FILTER (WHERE sequence IS NULL) AS messages_without_sequence
FROM chat_messages;
