\set ON_ERROR_STOP on

-- Expand phase: expose the nullable column and default without scanning existing rows.
BEGIN;

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS is_innovation_pioneer boolean;

ALTER TABLE accounts
  ALTER COLUMN is_innovation_pioneer SET DEFAULT TRUE;

COMMIT;

-- Backfill phase: preserve explicit FALSE values on every rerun.
BEGIN;

UPDATE accounts
SET is_innovation_pioneer = TRUE
WHERE is_innovation_pioneer IS NULL;

COMMIT;

-- Constraint phase: add an idempotent temporary proof without scanning existing rows yet.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ck_accounts_innovation_pioneer_not_null'
      AND conrelid = 'accounts'::regclass
  ) THEN
    ALTER TABLE accounts
      ADD CONSTRAINT ck_accounts_innovation_pioneer_not_null
      CHECK (is_innovation_pioneer IS NOT NULL) NOT VALID;
  END IF;
END
$$;

COMMIT;

-- Validation phase: scan rows without holding the final ACCESS EXCLUSIVE lock.
BEGIN;

ALTER TABLE accounts
  VALIDATE CONSTRAINT ck_accounts_innovation_pioneer_not_null;

COMMIT;

-- Contract phase: use the validated proof in a short, bounded lock transaction.
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE accounts
  ALTER COLUMN is_innovation_pioneer SET NOT NULL;

ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS ck_accounts_innovation_pioneer_not_null;

COMMIT;

-- Postconditions: verify the default/constraint and confirm no NULL rows remain.
SELECT
  column_name,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = current_schema()
  AND table_name = 'accounts'
  AND column_name = 'is_innovation_pioneer';

SELECT COUNT(*) AS null_innovation_pioneer_accounts
FROM accounts
WHERE is_innovation_pioneer IS NULL;

SELECT
  COUNT(*) FILTER (WHERE is_innovation_pioneer IS TRUE) AS enabled_accounts,
  COUNT(*) FILTER (WHERE is_innovation_pioneer IS FALSE) AS disabled_accounts
FROM accounts;

SELECT COUNT(*) AS temporary_innovation_pioneer_constraints
FROM pg_constraint
WHERE conname = 'ck_accounts_innovation_pioneer_not_null'
  AND conrelid = 'accounts'::regclass;
