-- Approved staff requests change the shift:
--   "Xin đi trễ" approved  -> shift_assignments.adjusted_start_at (start in force)
--   "Xin về sớm" approved  -> shift_assignments.adjusted_end_at   (end in force)
-- plus the owner's "Tăng ca tối đa mỗi ca" (store_timekeeping_settings).
--
-- Order: run BEFORE deploying the backend that reads these columns (TypeORM
-- selects every mapped column, so the new backend fails without them).
-- Additive and safe to re-run. The old backend ignores the new columns.
--
-- Backfill (decided with the owner): requests approved before this release
-- apply to their shifts that have not started yet; shifts already started or
-- done keep what they had.
--
-- Run: psql ... -v ON_ERROR_STOP=1 -f scripts/migration_shift_request_effects.sql

\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE shift_assignments ADD COLUMN IF NOT EXISTS adjusted_start_at timestamptz;
ALTER TABLE shift_assignments ADD COLUMN IF NOT EXISTS adjusted_end_at timestamptz;
ALTER TABLE shift_assignments ADD COLUMN IF NOT EXISTS late_request_id uuid;
ALTER TABLE shift_assignments ADD COLUMN IF NOT EXISTS early_request_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_shift_assignments_late_request') THEN
    ALTER TABLE shift_assignments
      ADD CONSTRAINT fk_shift_assignments_late_request
      FOREIGN KEY (late_request_id) REFERENCES employee_leave_requests(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_shift_assignments_early_request') THEN
    ALTER TABLE shift_assignments
      ADD CONSTRAINT fk_shift_assignments_early_request
      FOREIGN KEY (early_request_id) REFERENCES employee_leave_requests(id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE store_timekeeping_settings
  ADD COLUMN IF NOT EXISTS max_overtime_minutes integer NOT NULL DEFAULT 480;

-- Backfill: approved late / early requests tied to a shift not started yet.
-- Times are Vietnam wall clock on the work date (the next day when that is
-- the one inside an overnight shift), and must fall inside the shift. One
-- statement per kind: an UPDATE ... FROM changes a row once, so a shift with
-- both an approved late and early request needs two.
WITH shift AS (
  SELECT sa.id, sa.employee_id,
         (ss.work_date + COALESCE(ss.start_time, ws.start_time)) AT TIME ZONE 'Asia/Ho_Chi_Minh' AS start_at,
         CASE
           WHEN COALESCE(ss.end_time, ws.end_time) <= COALESCE(ss.start_time, ws.start_time)
             THEN (ss.work_date + 1 + COALESCE(ss.end_time, ws.end_time)) AT TIME ZONE 'Asia/Ho_Chi_Minh'
           ELSE (ss.work_date + COALESCE(ss.end_time, ws.end_time)) AT TIME ZONE 'Asia/Ho_Chi_Minh'
         END AS end_at,
         ss.work_date
    FROM shift_assignments sa
    JOIN shift_slots ss ON ss.id = sa.shift_slot_id
    JOIN work_shifts ws ON ws.id = ss.work_shift_id
   WHERE sa.deleted_at IS NULL
     AND sa.status = 'APPROVED'
     AND sa.check_in_time IS NULL
     AND sa.adjusted_start_at IS NULL
     AND COALESCE(ss.start_time, ws.start_time) IS NOT NULL
     AND COALESCE(ss.end_time, ws.end_time) IS NOT NULL
),
req AS (
  SELECT DISTINCT ON (lr.shift_assignment_id)
         lr.id, lr.shift_assignment_id, lr.employee_profile_id, lr.start_time AS req_time
    FROM employee_leave_requests lr
   WHERE lr.deleted_at IS NULL
     AND lr.status = 'APPROVED'
     AND lr.type = 'LATE'
     AND lr.shift_assignment_id IS NOT NULL
     AND lr.start_time IS NOT NULL
   ORDER BY lr.shift_assignment_id, lr.updated_at DESC
),
resolved AS (
  SELECT req.id AS request_id, shift.id AS assignment_id,
         CASE
           WHEN (shift.work_date + req.req_time) AT TIME ZONE 'Asia/Ho_Chi_Minh' >= shift.start_at
             THEN (shift.work_date + req.req_time) AT TIME ZONE 'Asia/Ho_Chi_Minh'
           ELSE (shift.work_date + 1 + req.req_time) AT TIME ZONE 'Asia/Ho_Chi_Minh'
         END AS at,
         shift.start_at, shift.end_at
    FROM req
    JOIN shift ON shift.id = req.shift_assignment_id
   -- Only the holder's own request (a shift handed over keeps its hours).
   WHERE shift.employee_id = req.employee_profile_id
     AND shift.start_at > now()
)
UPDATE shift_assignments sa
   SET adjusted_start_at = r.at,
       late_request_id = r.request_id
  FROM resolved r
 WHERE sa.id = r.assignment_id
   AND r.at >= r.start_at AND r.at <= r.end_at
   AND r.at < r.end_at;

WITH shift AS (
  SELECT sa.id, sa.employee_id,
         (ss.work_date + COALESCE(ss.start_time, ws.start_time)) AT TIME ZONE 'Asia/Ho_Chi_Minh' AS start_at,
         CASE
           WHEN COALESCE(ss.end_time, ws.end_time) <= COALESCE(ss.start_time, ws.start_time)
             THEN (ss.work_date + 1 + COALESCE(ss.end_time, ws.end_time)) AT TIME ZONE 'Asia/Ho_Chi_Minh'
           ELSE (ss.work_date + COALESCE(ss.end_time, ws.end_time)) AT TIME ZONE 'Asia/Ho_Chi_Minh'
         END AS end_at,
         ss.work_date
    FROM shift_assignments sa
    JOIN shift_slots ss ON ss.id = sa.shift_slot_id
    JOIN work_shifts ws ON ws.id = ss.work_shift_id
   WHERE sa.deleted_at IS NULL
     AND sa.status = 'APPROVED'
     AND sa.check_in_time IS NULL
     AND sa.adjusted_end_at IS NULL
     AND COALESCE(ss.start_time, ws.start_time) IS NOT NULL
     AND COALESCE(ss.end_time, ws.end_time) IS NOT NULL
),
req AS (
  SELECT DISTINCT ON (lr.shift_assignment_id)
         lr.id, lr.shift_assignment_id, lr.employee_profile_id, lr.end_time AS req_time
    FROM employee_leave_requests lr
   WHERE lr.deleted_at IS NULL
     AND lr.status = 'APPROVED'
     AND lr.type = 'EARLY'
     AND lr.shift_assignment_id IS NOT NULL
     AND lr.end_time IS NOT NULL
   ORDER BY lr.shift_assignment_id, lr.updated_at DESC
),
resolved AS (
  SELECT req.id AS request_id, shift.id AS assignment_id,
         CASE
           WHEN (shift.work_date + req.req_time) AT TIME ZONE 'Asia/Ho_Chi_Minh' >= shift.start_at
             THEN (shift.work_date + req.req_time) AT TIME ZONE 'Asia/Ho_Chi_Minh'
           ELSE (shift.work_date + 1 + req.req_time) AT TIME ZONE 'Asia/Ho_Chi_Minh'
         END AS at,
         shift.start_at, shift.end_at
    FROM req
    JOIN shift ON shift.id = req.shift_assignment_id
   -- Only the holder's own request (a shift handed over keeps its hours).
   WHERE shift.employee_id = req.employee_profile_id
     AND shift.start_at > now()
)
UPDATE shift_assignments sa
   SET adjusted_end_at = r.at,
       early_request_id = r.request_id
  FROM resolved r
 WHERE sa.id = r.assignment_id
   AND r.at >= r.start_at AND r.at <= r.end_at
   AND r.at > r.start_at;

COMMIT;

-- Verify
SELECT count(*) FILTER (WHERE adjusted_start_at IS NOT NULL) AS late_applied,
       count(*) FILTER (WHERE adjusted_end_at IS NOT NULL) AS early_applied
  FROM shift_assignments;
SELECT column_name, data_type, column_default
  FROM information_schema.columns
 WHERE table_name = 'store_timekeeping_settings' AND column_name = 'max_overtime_minutes';
