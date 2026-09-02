-- Operator index phase. Run only after preflight + expand have committed.
-- psql is required because CREATE INDEX CONCURRENTLY cannot run in a transaction.
-- Each statement is independently retryable. If PostgreSQL leaves an invalid
-- index after interruption, inspect pg_index, DROP INDEX CONCURRENTLY that exact
-- invalid index, and retry this script during the reviewed rollout window.
\set ON_ERROR_STOP on
\set AUTOCOMMIT on

SET lock_timeout = '3s';
SET statement_timeout = '30min';

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ux_chat_group_message_sequence
  ON chat_messages(group_id, sequence)
  WHERE sequence IS NOT NULL;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ux_chat_message_client_idempotency
  ON chat_messages(group_id, sender_id, client_message_id)
  WHERE client_message_id IS NOT NULL;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ux_chat_group_member_active
  ON chat_group_members(group_id, account_id)
  WHERE status = 'active' AND deleted_at IS NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_chat_group_member_account_active
  ON chat_group_members(account_id, group_id)
  WHERE status = 'active' AND deleted_at IS NULL;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ux_chat_outbox_message_created
  ON chat_outbox_events(message_id, event_type)
  WHERE event_type = 'MESSAGE_CREATED_V1' AND deleted_at IS NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_chat_outbox_dispatch
  ON chat_outbox_events(status, available_at, created_at)
  WHERE status IN ('pending', 'processing') AND deleted_at IS NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_chat_outbox_lease
  ON chat_outbox_events(locked_at)
  WHERE status = 'processing' AND deleted_at IS NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_chat_outbox_group_sequence
  ON chat_outbox_events(group_id, sequence);
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_chat_outbox_cleanup_published
  ON chat_outbox_events(published_at)
  WHERE status = 'published';
CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_chat_outbox_cleanup_dead
  ON chat_outbox_events(dead_at)
  WHERE status = 'dead';
