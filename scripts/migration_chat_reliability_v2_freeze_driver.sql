-- psql-only, resumable freeze driver. Run after expand with AUTOCOMMIT on.
-- Each generated SELECT is a separate transaction, so no batch holds locks
-- across groups. Re-run until prepared_groups is zero.
\set ON_ERROR_STOP on
\set AUTOCOMMIT on
SET lock_timeout = '3s';
SET statement_timeout = '15s';

SELECT format(
  'SELECT chat_prepare_message_sequence(%L::uuid);',
  chat_group.id
)
FROM chat_groups chat_group
WHERE chat_group.next_message_sequence IS NULL
ORDER BY chat_group.id
LIMIT 250
\gexec

SELECT COUNT(*) AS unprepared_groups
FROM chat_groups
WHERE next_message_sequence IS NULL;
