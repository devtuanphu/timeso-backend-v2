-- salary_advance_requests.employee_salary_id -> employee_salaries(id):
-- ON DELETE CASCADE  ->  ON DELETE NO ACTION
--
-- Why: with CASCADE, deleting (or regenerating) a payslip silently deleted
-- every salary advance request recorded against it, including APPROVED
-- advances that had already been paid out. The recalculation then rebuilt the
-- payslip with advancePayment = 0 and the employee was paid twice.
--
-- NO ACTION (not RESTRICT): NO ACTION is checked at the end of the statement,
-- so deleting an employee profile, which cascades to both employee_salaries
-- and salary_advance_requests in one statement, still succeeds. RESTRICT is
-- checked immediately and can abort that cascade depending on trigger order.
--
-- Idempotent: re-running it is a no-op once the FK is NO ACTION.
-- Run BEFORE deploying the payroll phase-2 code (see rollout notes).
-- Locking: brief SHARE ROW EXCLUSIVE on both tables (small tables).
-- Rollback (not recommended): the same statements with ON DELETE CASCADE.

BEGIN;

-- Preflight (informational): advances per payslip that the old FK would have
-- cascade-deleted with it.
-- SELECT employee_salary_id, status, COUNT(*)
-- FROM salary_advance_requests GROUP BY 1, 2 ORDER BY 1;

DO $$
DECLARE
  r record;
BEGIN
  -- Drop any CASCADE FK on salary_advance_requests(employee_salary_id) ->
  -- employee_salaries, whatever it is named.
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid AND c.conkey = ARRAY[a.attnum]
    WHERE c.contype = 'f'
      AND c.conrelid  = 'public.salary_advance_requests'::regclass
      AND c.confrelid = 'public.employee_salaries'::regclass
      AND a.attname   = 'employee_salary_id'
      AND c.confdeltype = 'c'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.salary_advance_requests DROP CONSTRAINT %I',
      r.conname
    );
  END LOOP;

  -- Re-create with NO ACTION under TypeORM's default name
  -- ('FK_' || left(sha1('salary_advance_requests_employee_salary_id'), 27)),
  -- so a later synchronize on a test database sees the same name and
  -- matching onDelete ('NO ACTION' in the entity).
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid AND c.conkey = ARRAY[a.attnum]
    WHERE c.contype = 'f'
      AND c.conrelid  = 'public.salary_advance_requests'::regclass
      AND c.confrelid = 'public.employee_salaries'::regclass
      AND a.attname   = 'employee_salary_id'
  ) THEN
    ALTER TABLE public.salary_advance_requests
      ADD CONSTRAINT "FK_bbf336adfc4425ec7176cb4f42b"
      FOREIGN KEY (employee_salary_id)
      REFERENCES public.employee_salaries(id)
      ON DELETE NO ACTION;
  END IF;
END $$;

COMMIT;

-- Verify (expect exactly one row with confdeltype = 'a', i.e. NO ACTION):
-- SELECT conname, confdeltype
-- FROM pg_constraint
-- WHERE conrelid  = 'public.salary_advance_requests'::regclass
--   AND confrelid = 'public.employee_salaries'::regclass;
