-- =============================================
-- Migration: staff job applications
-- Adds store_job_applications for the staff apply -> owner hire flow.
--
-- Re-runnable: every statement is guarded. Note that `CREATE TABLE IF NOT
-- EXISTS` only makes a second run non-erroring, it does not reconcile an
-- existing divergent table -- verify with the queries at the bottom after
-- running against a database that may already have this table.
--
-- Creates no enum value on notifications_type_enum:
-- job-application notifications reuse the existing SYSTEM type and carry their
-- destination in action_url / metadata, so no ALTER TYPE (which cannot run in a
-- transaction) is needed and there is no deploy-ordering hazard.
-- =============================================

BEGIN;

-- 1. Status enum, named to match TypeORM's convention <table>_<column>_enum
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'store_job_applications_status_enum'
  ) THEN
    CREATE TYPE store_job_applications_status_enum AS ENUM (
      'PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED'
    );
  END IF;
END
$$;

-- 2. Table
CREATE TABLE IF NOT EXISTS store_job_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,

  store_id uuid NOT NULL,
  account_id uuid NOT NULL,

  full_name text NOT NULL,
  -- Contact fields are nullable so the retention job can clear them once an
  -- application has been reviewed for longer than the retention window.
  phone text,
  email text,
  introduction text,
  contact_redacted_at timestamptz,

  status store_job_applications_status_enum NOT NULL DEFAULT 'PENDING',

  reviewed_by_id uuid,
  reviewed_at timestamptz,
  rejection_reason text,
  employee_profile_id uuid,

  CONSTRAINT fk_job_applications_store
    FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE CASCADE,
  CONSTRAINT fk_job_applications_account
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
  -- Reviewer and hired profile are cleared rather than cascading, so the
  -- application history survives an account or employee removal.
  CONSTRAINT fk_job_applications_reviewer
    FOREIGN KEY (reviewed_by_id) REFERENCES accounts(id) ON DELETE SET NULL,
  CONSTRAINT fk_job_applications_profile
    FOREIGN KEY (employee_profile_id) REFERENCES employee_profiles(id) ON DELETE SET NULL
);

-- 3. One open application per (store, account).
--    Partial, so a rejected/cancelled application can be superseded by a new
--    attempt while the history is preserved.
CREATE UNIQUE INDEX IF NOT EXISTS uq_job_applications_one_pending
  ON store_job_applications (store_id, account_id)
  WHERE status = 'PENDING' AND deleted_at IS NULL;

-- 4. Owner inbox lookup.
CREATE INDEX IF NOT EXISTS idx_job_applications_store_status
  ON store_job_applications (store_id, status)
  WHERE deleted_at IS NULL;

-- 5. Retention sweep: finds reviewed applications whose contact details are
--    still present. Partial, so it stays small as rows are redacted.
CREATE INDEX IF NOT EXISTS idx_job_applications_retention
  ON store_job_applications (reviewed_at)
  WHERE reviewed_at IS NOT NULL AND contact_redacted_at IS NULL AND deleted_at IS NULL;

-- 6. Applicant lookup, used by the staff discovery screen.
CREATE INDEX IF NOT EXISTS idx_job_applications_account
  ON store_job_applications (account_id)
  WHERE deleted_at IS NULL;

COMMIT;

-- =============================================
-- Verification
-- =============================================
-- SELECT indexname FROM pg_indexes WHERE tablename = 'store_job_applications';
-- SELECT unnest(enum_range(NULL::store_job_applications_status_enum));

-- =============================================
-- Rollback
-- =============================================
-- BEGIN;
-- DROP TABLE IF EXISTS store_job_applications;
-- DROP TYPE IF EXISTS store_job_applications_status_enum;
-- COMMIT;
