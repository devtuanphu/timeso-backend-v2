-- Contract phase. Run only after contract_prepare + contract_validate and
-- verify_chat_reliability_v2.sql pass, and after old writers are retired.
-- The validated check lets PostgreSQL prove SET NOT NULL without a full scan.
-- This phase is retry-safe after an ambiguous disconnect: an already-NOT-NULL
-- sequence column is accepted even when its temporary proof was already dropped.
\set ON_ERROR_STOP on
SET lock_timeout = '3s';
SET statement_timeout = '15s';
DO $$
DECLARE
  message_sequence_is_not_null boolean;
BEGIN
  SELECT attribute.attnotnull
    INTO message_sequence_is_not_null
  FROM pg_attribute attribute
  WHERE attribute.attrelid = 'chat_messages'::regclass
    AND attribute.attname = 'sequence'
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped;

  IF message_sequence_is_not_null IS NULL THEN
    RAISE EXCEPTION 'chat contract: sequence column is missing';
  END IF;

  IF NOT message_sequence_is_not_null AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_chat_message_sequence_not_null'
      AND conrelid = 'chat_messages'::regclass
      AND convalidated
  ) THEN
    RAISE EXCEPTION 'chat contract: sequence non-null proof is not validated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_chat_message_sequence_positive'
      AND conrelid = 'chat_messages'::regclass
      AND convalidated
  ) THEN
    RAISE EXCEPTION 'chat contract: sequence positive proof is not validated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_chat_member_read_sequence_nonnegative'
      AND conrelid = 'chat_group_members'::regclass
      AND convalidated
  ) THEN
    RAISE EXCEPTION 'chat contract: read sequence proof is not validated';
  END IF;
END $$;
ALTER TABLE chat_groups
  ALTER COLUMN next_message_sequence SET NOT NULL;
ALTER TABLE chat_messages
  ALTER COLUMN sequence SET NOT NULL;
ALTER TABLE chat_messages
  DROP CONSTRAINT IF EXISTS ck_chat_message_sequence_not_null;

-- Keep trg_chat_assign_message_sequence until every legacy HTTP/socket writer is removed.
-- Drop backfill helper functions/table only in a separately reviewed cleanup release.
