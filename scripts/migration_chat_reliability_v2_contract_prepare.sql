-- Retry-safe preparation: add proof constraints without validating table data.
-- Run with psql. Fail fast and retry this whole phase after any bounded timeout.
\set ON_ERROR_STOP on
SET lock_timeout = '3s';
SET statement_timeout = '15s';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_chat_message_sequence_not_null'
      AND conrelid = 'chat_messages'::regclass
  ) THEN
    ALTER TABLE chat_messages ADD CONSTRAINT ck_chat_message_sequence_not_null
      CHECK (sequence IS NOT NULL) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_chat_message_sequence_positive'
      AND conrelid = 'chat_messages'::regclass
  ) THEN
    ALTER TABLE chat_messages ADD CONSTRAINT ck_chat_message_sequence_positive
      CHECK (sequence > 0) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ck_chat_member_read_sequence_nonnegative'
      AND conrelid = 'chat_group_members'::regclass
  ) THEN
    ALTER TABLE chat_group_members ADD CONSTRAINT ck_chat_member_read_sequence_nonnegative
      CHECK (last_read_sequence IS NULL OR last_read_sequence >= 0) NOT VALID;
  END IF;
END $$;
