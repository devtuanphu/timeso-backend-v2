-- "Cách tính giờ công": per-store / per-employee worked-time mode rules.
--
-- SHIFT  = "Tính theo lịch làm" (only the scheduled shift + approved overtime);
-- ACTUAL = "Tính theo giờ chấm công" (actual check-in to check-out).
-- employee_profile_id NULL = the whole store. A rule for several employees =
-- one row per employee sharing group_id.
--
-- A rule covers the shifts whose scheduled start (Vietnam wall clock) is in
-- [start_date start_time, end_date end_time); end_date NULL = indefinite.
-- Removing a rule (deleted_at, timestamptz) only stops it for shifts starting
-- from that instant. Rows saved before start times existed have end_time NULL
-- and an inclusive end_date; the backend still reads them that way, and this
-- script converts them.
--
-- Order: run BEFORE deploying the backend that reads the new columns, and once
-- more right AFTER it (converts rows the previous backend saved meanwhile).
-- Safe to re-run. Additive only.
--
-- Run: psql ... -v ON_ERROR_STOP=1 -f scripts/migration_worked_time_rules.sql

\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS store_worked_time_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  employee_profile_id uuid REFERENCES employee_profiles(id) ON DELETE CASCADE,
  group_id uuid,
  mode varchar(16) NOT NULL CHECK (mode IN ('SHIFT', 'ACTUAL')),
  period varchar(16) NOT NULL CHECK (period IN ('DAY', 'WEEK', 'MONTH', 'INDEFINITE')),
  start_date date NOT NULL,
  start_time varchar(5),
  end_date date,
  end_time varchar(5),
  created_by_account_id uuid,
  CONSTRAINT chk_store_worked_time_rules_range CHECK (end_date IS NULL OR end_date >= start_date)
);

-- Databases that ran an earlier version of this script.
ALTER TABLE store_worked_time_rules ADD COLUMN IF NOT EXISTS group_id uuid;
ALTER TABLE store_worked_time_rules ADD COLUMN IF NOT EXISTS start_time varchar(5);
ALTER TABLE store_worked_time_rules ADD COLUMN IF NOT EXISTS end_time varchar(5);

-- 1. Rules removed before start times existed: removal used to undo the rule
--    for every shift, so they cover nothing (empty window).
UPDATE store_worked_time_rules
   SET end_date = start_date, end_time = '00:00', start_time = '00:00'
 WHERE start_time IS NULL AND deleted_at IS NOT NULL;

-- 2. Inclusive last day -> exclusive end at 00:00 the next day (also rows the
--    previous backend saves between this script and the deploy).
UPDATE store_worked_time_rules
   SET end_date = end_date + 1, end_time = '00:00'
 WHERE end_date IS NOT NULL AND end_time IS NULL;

-- 3. Start of day for the rest.
UPDATE store_worked_time_rules SET start_time = '00:00' WHERE start_time IS NULL;

ALTER TABLE store_worked_time_rules ALTER COLUMN start_time SET DEFAULT '00:00';
ALTER TABLE store_worked_time_rules ALTER COLUMN start_time SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_store_worked_time_rules_times'
  ) THEN
    ALTER TABLE store_worked_time_rules
      ADD CONSTRAINT chk_store_worked_time_rules_times CHECK (
        start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        AND (end_time IS NULL OR end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_store_worked_time_rules_store_start
  ON store_worked_time_rules (store_id, start_date)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_store_worked_time_rules_group
  ON store_worked_time_rules (group_id)
  WHERE group_id IS NOT NULL;

COMMIT;

-- Verify: deleted_at must be an instant (timestamptz) for removal cut-offs.
SELECT data_type AS deleted_at_type
  FROM information_schema.columns
 WHERE table_name = 'store_worked_time_rules' AND column_name = 'deleted_at';
SELECT mode, period, start_date, start_time, end_date, end_time,
       employee_profile_id IS NOT NULL AS per_employee, deleted_at IS NOT NULL AS removed
  FROM store_worked_time_rules
 ORDER BY created_at;
