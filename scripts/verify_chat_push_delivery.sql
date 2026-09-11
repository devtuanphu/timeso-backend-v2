-- Aggregate-only post-expand verification. Does not expose push tokens.
\set ON_ERROR_STOP on
SET lock_timeout = '3s';
SET statement_timeout = '2min';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_index index_row
    JOIN pg_class index_class ON index_class.oid = index_row.indexrelid
    JOIN pg_namespace schema_row ON schema_row.oid = index_class.relnamespace
    WHERE schema_row.nspname = current_schema()
      AND index_class.relname IN (
        'ux_user_devices_active_push_fingerprint',
        'ix_chat_outbox_push_intent_dispatch',
        'ix_chat_outbox_push_intent_lease'
      )
      AND NOT index_row.indisvalid
  ) OR (
    SELECT COUNT(*)
    FROM pg_index index_row
    JOIN pg_class index_class ON index_class.oid = index_row.indexrelid
    JOIN pg_namespace schema_row ON schema_row.oid = index_class.relnamespace
    WHERE schema_row.nspname = current_schema()
      AND index_class.relname IN (
        'ux_user_devices_active_push_fingerprint',
        'ix_chat_outbox_push_intent_dispatch',
        'ix_chat_outbox_push_intent_lease'
      )
  ) <> 3 THEN
    RAISE EXCEPTION 'chat push verification: required concurrent indexes missing or invalid';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM pg_constraint constraint_row
    JOIN pg_class table_row ON table_row.oid = constraint_row.conrelid
    JOIN pg_namespace schema_row ON schema_row.oid = table_row.relnamespace
    WHERE schema_row.nspname = current_schema()
      AND table_row.relname = 'chat_outbox_events'
      AND constraint_row.conname IN (
        'ck_chat_outbox_push_intent_status',
        'ck_chat_outbox_push_intent_attempts'
      )
      AND constraint_row.convalidated
  ) <> 2 THEN
    RAISE EXCEPTION 'chat push verification: required outbox constraints missing or unvalidated';
  END IF;
END $$;

SELECT COUNT(*)::bigint AS duplicate_active_fingerprint_groups
FROM (
  SELECT push_token_fingerprint
  FROM user_devices
  WHERE push_token_fingerprint IS NOT NULL
    AND is_active = true AND deleted_at IS NULL
  GROUP BY push_token_fingerprint HAVING COUNT(*) > 1
) duplicate_groups;

SELECT status, COUNT(*)::bigint AS delivery_count
FROM chat_push_deliveries
WHERE deleted_at IS NULL
GROUP BY status ORDER BY status;

SELECT COUNT(*)::bigint AS orphan_delivery_count
FROM chat_push_deliveries delivery
LEFT JOIN chat_messages message ON message.id = delivery.message_id
LEFT JOIN chat_groups chat_group ON chat_group.id = delivery.group_id
LEFT JOIN accounts account ON account.id = delivery.intended_account_id
LEFT JOIN user_devices device ON device.id = delivery.user_device_id
WHERE message.id IS NULL OR chat_group.id IS NULL OR account.id IS NULL OR device.id IS NULL;

SELECT COUNT(*)::bigint AS stale_processing_count
FROM chat_push_deliveries
WHERE status = 'processing' AND locked_at < NOW() - INTERVAL '5 minutes';
