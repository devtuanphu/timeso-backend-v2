-- Kiểm tra sau migration_chat_direct_expand.sql. Chỉ đọc; lỗi thì RAISE.
\set ON_ERROR_STOP on
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = to_regclass('chat_groups')
      AND attname = 'direct_key'
      AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'chat direct verify: chat_groups.direct_key missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class index_class
    JOIN pg_index index_state ON index_state.indexrelid = index_class.oid
    JOIN pg_namespace schema_row ON schema_row.oid = index_class.relnamespace
    WHERE index_class.relname = 'uq_chat_groups_direct_key'
      AND schema_row.nspname = current_schema()
      AND index_state.indisvalid = true
      AND index_state.indisunique = true
      AND index_state.indpred IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'chat direct verify: uq_chat_groups_direct_key missing, invalid, not unique or not partial';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM chat_group_members member
    JOIN chat_groups chat_group ON chat_group.id = member.group_id
    WHERE chat_group.direct_key IS NOT NULL
      AND chat_group.deleted_at IS NULL
      AND member.status = 'active'
      AND member.deleted_at IS NULL
    GROUP BY member.group_id
    HAVING COUNT(*) > 2
  ) THEN
    RAISE EXCEPTION 'chat direct verify: a direct chat has more than 2 active members';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM chat_group_members member
    WHERE member.status = 'active'
      AND member.deleted_at IS NULL
    GROUP BY member.group_id, member.account_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'chat direct verify: duplicate active member rows';
  END IF;
END $$;
