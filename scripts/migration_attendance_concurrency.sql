BEGIN;

-- Keep one audit row per assignment and attendance action.
DELETE FROM attendance_logs older
USING attendance_logs newer
WHERE older.shift_assignment_id = newer.shift_assignment_id
  AND older.type = newer.type
  AND older.ctid < newer.ctid;

-- Point salary advances at the surviving salary row before removing duplicates.
WITH ranked AS (
  SELECT
    id,
    FIRST_VALUE(id) OVER (
      PARTITION BY employee_profile_id, month
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id
    ) AS survivor_id
  FROM employee_salaries
)
UPDATE salary_advance_requests request
SET employee_salary_id = ranked.survivor_id
FROM ranked
WHERE request.employee_salary_id = ranked.id
  AND ranked.id <> ranked.survivor_id;

WITH ranked AS (
  SELECT
    ctid,
    ROW_NUMBER() OVER (
      PARTITION BY employee_profile_id, month
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id
    ) AS row_number
  FROM employee_salaries
)
DELETE FROM employee_salaries salary
USING ranked
WHERE salary.ctid = ranked.ctid
  AND ranked.row_number > 1;

-- Re-link employee salaries before collapsing duplicate monthly payroll rows.
WITH ranked AS (
  SELECT
    id,
    FIRST_VALUE(id) OVER (
      PARTITION BY store_id, month
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id
    ) AS survivor_id
  FROM monthly_payrolls
)
UPDATE employee_salaries salary
SET monthly_payroll_id = ranked.survivor_id
FROM ranked
WHERE salary.monthly_payroll_id = ranked.id
  AND ranked.id <> ranked.survivor_id;

WITH ranked AS (
  SELECT
    ctid,
    ROW_NUMBER() OVER (
      PARTITION BY store_id, month
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id
    ) AS row_number
  FROM monthly_payrolls
)
DELETE FROM monthly_payrolls payroll
USING ranked
WHERE payroll.ctid = ranked.ctid
  AND ranked.row_number > 1;

CREATE UNIQUE INDEX IF NOT EXISTS ux_attendance_logs_assignment_type
  ON attendance_logs (shift_assignment_id, type);
CREATE UNIQUE INDEX IF NOT EXISTS ux_employee_salaries_employee_month
  ON employee_salaries (employee_profile_id, month);
CREATE UNIQUE INDEX IF NOT EXISTS ux_monthly_payrolls_store_month
  ON monthly_payrolls (store_id, month);

COMMIT;
