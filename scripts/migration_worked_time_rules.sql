-- "Cách tính giờ công": per-store / per-employee worked-time mode rules.
--
-- SHIFT  = "Tính lương theo ca" (only the shift window + approved overtime);
-- ACTUAL = "Làm bao nhiêu trả bấy nhiêu" (actual check-in to check-out).
-- employee_profile_id NULL = the whole store. end_date NULL = indefinite.
-- A rule for several employees = one row per employee sharing group_id.
-- Without any rule the backend uses SHIFT (behaviour since 92dbc93).
--
-- Order: run BEFORE deploying the backend that reads the table (the backend
-- falls back to SHIFT if the table is missing, so a late run is not fatal).
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
  end_date date,
  created_by_account_id uuid,
  CONSTRAINT chk_store_worked_time_rules_range CHECK (end_date IS NULL OR end_date >= start_date)
);

-- Databases that ran an earlier draft of this script.
ALTER TABLE store_worked_time_rules ADD COLUMN IF NOT EXISTS group_id uuid;

CREATE INDEX IF NOT EXISTS idx_store_worked_time_rules_store_start
  ON store_worked_time_rules (store_id, start_date)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_store_worked_time_rules_group
  ON store_worked_time_rules (group_id)
  WHERE group_id IS NOT NULL;

COMMIT;

-- Verify
SELECT count(*) AS rules FROM store_worked_time_rules;
