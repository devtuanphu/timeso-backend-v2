BEGIN;

ALTER TABLE work_shifts
  ADD COLUMN IF NOT EXISTS note text;

ALTER TABLE work_cycles
  ADD COLUMN IF NOT EXISTS work_shift_id uuid,
  ADD COLUMN IF NOT EXISTS recurrence_rule jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_work_cycles_work_shift'
  ) THEN
    ALTER TABLE work_cycles
      ADD CONSTRAINT fk_work_cycles_work_shift
      FOREIGN KEY (work_shift_id)
      REFERENCES work_shifts(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_work_cycles_work_shift_id
  ON work_cycles(work_shift_id);

CREATE INDEX IF NOT EXISTS idx_work_cycles_unified_active
  ON work_cycles(store_id, status)
  WHERE recurrence_rule IS NOT NULL;

COMMIT;

