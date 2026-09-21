-- Phase 3 / D1: fill kpi_tasks.store_id for tasks created by released owner
-- builds.
--
-- createEmployeeKpi spread each task body into the row; the owner app sends
-- `tasks[].storeIds` (an array) while the column is `store_id`, so the store
-- was silently dropped and stayed NULL. The API now reads `storeIds[0]`
-- (constrained to the KPI's stores). This sets the missing value to the
-- KPI's first store, the same default the API uses.
--
-- Order: deploy the backend first (so no new NULLs appear), then run once.
-- Safe to re-run: only rows with store_id IS NULL are touched; a second run
-- changes 0 rows. Soft-deleted tasks are left alone.

BEGIN;

UPDATE kpi_tasks t
   SET store_id = k.store_ids[1]
  FROM employee_kpis k
 WHERE t.employee_kpi_id = k.id
   AND t.store_id IS NULL
   AND t.deleted_at IS NULL
   AND cardinality(k.store_ids) >= 1;

COMMIT;
