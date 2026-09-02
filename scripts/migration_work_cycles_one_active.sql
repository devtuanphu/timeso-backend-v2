BEGIN;

-- Preflight (run separately if this migration is blocked):
-- SELECT store_id, COUNT(*) AS active_count
-- FROM work_cycles
-- WHERE status = 'ACTIVE'
-- GROUP BY store_id
-- HAVING COUNT(*) > 1;
-- Resolve each duplicate set by stopping/merging the unwanted cycles and
-- preserving their slots before rerunning this migration. This script refuses
-- to guess which schedule is authoritative.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM work_cycles
    WHERE status = 'ACTIVE'
    GROUP BY store_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce one ACTIVE work cycle per store: duplicate ACTIVE rows exist. Run the preflight query and resolve them first.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_work_cycles_one_active_per_store
  ON work_cycles (store_id)
  WHERE status = 'ACTIVE';

COMMIT;
