-- X5 "Khung giờ khác": staff custom-time shift requests, approved by the owner.
--
-- Additive and idempotent: safe to run more than once. Apply by hand with psql
-- BEFORE deploying the build that reads/writes it (DATABASE_SCHEMA_MODE=managed,
-- synchronize=false). New table only; no backfill, no change to existing rows.
-- Rollback: redeploy the previous build; the table may stay (or DROP TABLE
-- custom_shift_requests once no longer wanted — approved requests have already
-- produced ordinary shifts, which are unaffected).

\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '3s';

CREATE TABLE IF NOT EXISTS custom_shift_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  employee_profile_id uuid NOT NULL REFERENCES employee_profiles(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date NOT NULL,
  -- 0 = Sunday … 6 = Saturday; NULL = every day of the range.
  days_of_week smallint[] NULL,
  start_time time NOT NULL,
  -- end_time <= start_time means the shift ends the next day.
  end_time time NOT NULL,
  note varchar(500) NULL,
  status varchar(16) NOT NULL DEFAULT 'PENDING',
  decided_by_account_id uuid NULL,
  decided_at timestamptz NULL,
  rejection_reason varchar(500) NULL,
  created_schedule_ref jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_custom_shift_requests_status
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
  CONSTRAINT ck_custom_shift_requests_dates
    CHECK (end_date >= start_date AND end_date - start_date <= 61),
  CONSTRAINT ck_custom_shift_requests_times
    CHECK (start_time <> end_time),
  CONSTRAINT ck_custom_shift_requests_days
    CHECK (
      days_of_week IS NULL
      OR (cardinality(days_of_week) BETWEEN 1 AND 7
          AND days_of_week <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::smallint[])
    )
);

CREATE INDEX IF NOT EXISTS ix_custom_shift_requests_store_status
  ON custom_shift_requests (store_id, status, created_at);
CREATE INDEX IF NOT EXISTS ix_custom_shift_requests_employee
  ON custom_shift_requests (employee_profile_id, created_at);

-- One PENDING request per employee + dates + weekdays + times: a double tap
-- or a retry cannot queue the same request twice. days_of_week is stored
-- sorted and de-duplicated by the service, NULL for "every day".
CREATE UNIQUE INDEX IF NOT EXISTS ux_custom_shift_requests_pending
  ON custom_shift_requests (
    employee_profile_id,
    start_date,
    end_date,
    (COALESCE(days_of_week, '{}'::smallint[])),
    start_time,
    end_time
  )
  WHERE status = 'PENDING';

COMMIT;
