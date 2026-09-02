-- Run separately from contract DDL. Validation avoids a long exclusive lock,
-- remains retry-safe, and is bounded so operators can retry outside peak load.
\set ON_ERROR_STOP on
SET lock_timeout = '3s';
SET statement_timeout = '10min';
ALTER TABLE chat_messages VALIDATE CONSTRAINT ck_chat_message_sequence_not_null;
ALTER TABLE chat_messages VALIDATE CONSTRAINT ck_chat_message_sequence_positive;
ALTER TABLE chat_group_members VALIDATE CONSTRAINT ck_chat_member_read_sequence_nonnegative;
