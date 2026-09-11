-- Read-only preflight for chat push delivery. Never selects or prints raw tokens.
\set ON_ERROR_STOP on
SET lock_timeout = '3s';
SET statement_timeout = '2min';

DO $$
BEGIN
  IF to_regclass('user_devices') IS NULL
     OR to_regclass('chat_outbox_events') IS NULL
     OR to_regclass('chat_messages') IS NULL THEN
    RAISE EXCEPTION 'chat push preflight: required source tables are missing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM user_devices
    WHERE deleted_at IS NULL AND is_active = true
    GROUP BY device_id HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'chat push preflight: duplicate active device ids';
  END IF;

  IF EXISTS (
    SELECT 1 FROM chat_outbox_events event
    LEFT JOIN chat_messages message ON message.id = event.message_id
    WHERE event.event_type = 'MESSAGE_CREATED_V1' AND message.id IS NULL
  ) THEN
    RAISE EXCEPTION 'chat push preflight: message outbox orphan detected';
  END IF;
END $$;

SELECT COUNT(*)::bigint AS active_legacy_device_count
FROM user_devices
WHERE deleted_at IS NULL AND is_active = true;

SELECT COUNT(*)::bigint AS duplicate_active_token_groups
FROM (
  SELECT md5(expo_push_token) AS token_group
  FROM user_devices
  WHERE deleted_at IS NULL AND is_active = true
  GROUP BY md5(expo_push_token)
  HAVING COUNT(*) > 1
) duplicate_groups;
