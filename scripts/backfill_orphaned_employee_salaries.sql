-- =============================================
-- One-off backfill: fix orphaned EmployeeSalary rows
-- Created: 2026-07-xx
--
-- Context: before the payroll fix, two write paths could produce
-- EmployeeSalary rows that were never linked to a MonthlyPayroll
-- (monthly_payroll_id IS NULL):
--   1. The real-time salary update on check-out (checkOutWithFace) upserted
--      EmployeeSalary without ever creating/looking up a MonthlyPayroll.
--   2. Any month where check-out happened before the monthly
--      create-payroll cron/endpoint had run for that store+month.
--
-- Orphaned rows are invisible to getEmployeeSalariesByStore /
-- getPayrollSummary (which join through monthly_payroll_id), so affected
-- employees silently disappeared from the owner app's "Nhân viên" tab even
-- though they had worked and had real salary data.
--
-- This script is idempotent — safe to re-run. It never touches rows that
-- are already linked (monthly_payroll_id IS NOT NULL) and never touches
-- payment_status = 'APPROVED' or 'PAID' rows beyond linking them.
-- =============================================

BEGIN;

-- 1. Preview: how many orphaned rows, grouped by store (via employee_profiles).
--    Run this SELECT first to see the blast radius before applying the UPDATE below.
-- SELECT ep.store_id, es.month, COUNT(*) AS orphaned_count
-- FROM employee_salaries es
-- JOIN employee_profiles ep ON ep.id = es.employee_profile_id
-- WHERE es.monthly_payroll_id IS NULL
-- GROUP BY ep.store_id, es.month
-- ORDER BY ep.store_id, es.month;

-- 2. Create any missing MonthlyPayroll scaffold rows for (store, month)
--    combinations that have orphaned EmployeeSalary rows but no
--    MonthlyPayroll yet.
--
-- NOTE: monthly_payrolls has no unique constraint on (store_id, month) in
-- this schema, so we can't rely on ON CONFLICT here — use NOT EXISTS to
-- keep this idempotent across re-runs.
INSERT INTO monthly_payrolls (
  id, store_id, month, estimated_payment, salary_fund, total_bonus,
  total_penalty, total_overtime, total_pending_approval, total_approved,
  is_finalized, created_at, updated_at
)
SELECT
  gen_random_uuid(),
  missing.store_id,
  missing.month,
  0, 0, 0, 0, 0, 0, 0,
  false,
  NOW(), NOW()
FROM (
  SELECT DISTINCT ep.store_id, es.month
  FROM employee_salaries es
  JOIN employee_profiles ep ON ep.id = es.employee_profile_id
  WHERE es.monthly_payroll_id IS NULL
) missing
WHERE NOT EXISTS (
  SELECT 1 FROM monthly_payrolls mp
  WHERE mp.store_id = missing.store_id AND mp.month = missing.month
);

-- 3. Link every orphaned EmployeeSalary to the MonthlyPayroll for its
--    (store, month). This only ever sets monthly_payroll_id — it does not
--    touch net_salary/bonus/penalty/payment_status, so PAID/APPROVED rows
--    are safe.
UPDATE employee_salaries es
SET monthly_payroll_id = mp.id,
    updated_at = NOW()
FROM employee_profiles ep, monthly_payrolls mp
WHERE es.employee_profile_id = ep.id
  AND mp.store_id = ep.store_id
  AND mp.month = es.month
  AND es.monthly_payroll_id IS NULL;

-- 4. Sanity checks — run BOTH before committing. If either returns rows,
--    STOP and investigate; do not just re-run createMonthlyPayrollForStore
--    blindly.
--
--    4a. No employee should have more than one EmployeeSalary row for the
--        same month.
-- SELECT employee_profile_id, month, COUNT(*)
-- FROM employee_salaries
-- GROUP BY employee_profile_id, month
-- HAVING COUNT(*) > 1;
--
--    4b. No store should have more than one MonthlyPayroll for the same
--        month (guards against a race if this script ran concurrently).
-- SELECT store_id, month, COUNT(*)
-- FROM monthly_payrolls
-- GROUP BY store_id, month
-- HAVING COUNT(*) > 1;

COMMIT;

-- =============================================
-- 5. After this script runs, refresh MonthlyPayroll totals so
--    estimated_payment/total_bonus/total_penalty reflect the newly-linked
--    rows. Do this via the app, per affected store+month, e.g.:
--
--   POST /stores/:storeId/payrolls/generate?month=YYYY-MM
--
-- This is safe to call even on months with PAID salaries — the app-level
-- fix in createMonthlyPayrollForStore now skips recalculating any
-- EmployeeSalary whose payment_status is APPROVED or PAID.
-- =============================================
