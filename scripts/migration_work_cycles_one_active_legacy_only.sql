-- Phase 3 / A1: allow several ACTIVE schedules per store.
--
-- migration_work_cycles_one_active.sql made "one ACTIVE work cycle per store"
-- a unique index. Schedules created by POST /stores/:id/shift-schedules carry
-- their own recurrence rule, end date and expiry, so a store may run several
-- of them at once. Only old-style cycles (recurrence_rule IS NULL) keep the
-- one-active rule, because the legacy nightly slot-copy job assumes a single
-- one per store.
--
-- Order: code first or SQL first both work (the API maps a violation of
-- either index name to the same 400).
--
-- Preflight (run separately if the guard below aborts):
--   SELECT store_id, COUNT(*) AS active_legacy
--     FROM work_cycles
--    WHERE status = 'ACTIVE' AND recurrence_rule IS NULL
--    GROUP BY store_id
--   HAVING COUNT(*) > 1;
--
-- Safe to re-run: every statement is IF [NOT] EXISTS.
--
-- Rollback: recreating uq_work_cycles_one_active_per_store is impossible once
-- any store has two ACTIVE schedules. Stop the extra schedules first, then
-- run migration_work_cycles_one_active.sql again.
--
-- Note: CREATE INDEX (without CONCURRENTLY) holds a SHARE lock on work_cycles
-- for the duration of the build. The table is small; run it off-peak anyway.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM work_cycles
     WHERE status = 'ACTIVE' AND recurrence_rule IS NULL
     GROUP BY store_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Duplicate ACTIVE legacy cycles exist; run the preflight query and resolve them before relaxing the index.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_work_cycles_one_active_legacy_per_store
  ON work_cycles (store_id)
  WHERE status = 'ACTIVE' AND recurrence_rule IS NULL;

DROP INDEX IF EXISTS uq_work_cycles_one_active_per_store;

COMMIT;
