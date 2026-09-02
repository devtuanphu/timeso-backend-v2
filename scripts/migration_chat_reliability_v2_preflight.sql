-- Chat Reliability V2 preflight. Read-only checks; aborts on unsafe source data.
-- After this passes and expand commits, operators must run
-- migration_chat_reliability_v2_indexes.sql before backfill/verification.
\set ON_ERROR_STOP on

DO $$
DECLARE
  v_has_duplicate_sequence boolean;
BEGIN
  IF EXISTS (
    SELECT 1 FROM chat_group_members
    WHERE status = 'active' AND deleted_at IS NULL
    GROUP BY group_id, account_id HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'chat preflight: duplicate active memberships';
  END IF;

  IF EXISTS (
    SELECT 1 FROM chat_groups g LEFT JOIN stores s ON s.id = g.store_id
    WHERE s.id IS NULL
  ) OR EXISTS (
    SELECT 1 FROM chat_groups g LEFT JOIN accounts a ON a.id = g.created_by
    WHERE a.id IS NULL
  ) OR EXISTS (
    SELECT 1 FROM chat_group_members m LEFT JOIN chat_groups g ON g.id = m.group_id
    WHERE g.id IS NULL
  ) OR EXISTS (
    SELECT 1 FROM chat_group_members m LEFT JOIN accounts a ON a.id = m.account_id
    WHERE a.id IS NULL
  ) OR EXISTS (
    SELECT 1 FROM chat_messages m LEFT JOIN chat_groups g ON g.id = m.group_id
    WHERE g.id IS NULL
  ) OR EXISTS (
    SELECT 1 FROM chat_messages m LEFT JOIN accounts a ON a.id = m.sender_id
    WHERE a.id IS NULL
  ) THEN
    RAISE EXCEPTION 'chat preflight: orphaned chat data';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = to_regclass('chat_messages')
      AND attname = 'sequence'
      AND NOT attisdropped
  ) THEN
    EXECUTE $query$
      SELECT EXISTS (
        SELECT 1 FROM chat_messages
        WHERE sequence IS NOT NULL
        GROUP BY group_id, sequence HAVING COUNT(*) > 1
      )
    $query$ INTO v_has_duplicate_sequence;
    IF v_has_duplicate_sequence THEN
      RAISE EXCEPTION 'chat preflight: duplicate message sequence';
    END IF;
  END IF;
END $$;
