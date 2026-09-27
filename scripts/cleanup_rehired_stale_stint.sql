-- =============================================
-- One-off cleanup: former-stint rows still live on rehired employees
--
-- Context: one employee_profiles row per (account, store) is kept across a
-- termination and a later rehire; the current stint starts at
-- employee_profiles.joined_at. Rehires performed before
-- `resetFormerStintForRehire` (stores.service.ts) existed left the previous
-- stint's rows live: an old contract still is_active (payroll picks the
-- active contract), an old face registration still active (check-in matches
-- it), assets from the previous stint still ASSIGNED. This script applies
-- the same reset, restricted to rows created before the current stint:
--
--   1. employee_contracts   is_active = true, created_at before the stint
--                           -> is_active = false
--   2. employee_faces       is_active = true, created_at before the stint
--                           -> is_active = false
--   3. employee_asset_assignments status = 'ASSIGNED', assigned_date before
--                           the stint, not soft-deleted
--                           -> 'RETURNED', returned_date = now(), same
--                              return_note, and the asset's current_stock is
--                              increased by the returned quantity, only for
--                              assets of the profile's own store (exactly as
--                              resetFormerStintForRehire does). Assets are
--                              locked in id order first, like the app.
--
-- Not touched: chat memberships, shift assignments, pending requests (the
-- app's reset also closes those, but they are not stale-stint rows that
-- current views read as live), payslips, attendance, salary history.
--
-- WHO IS AFFECTED (the rehire criterion)
-- A profile is treated as rehired only when ALL of:
--   * joined_at IS NOT NULL, deleted_at IS NULL, and employment_status is
--     employed ('active', 'probation', 'on_leave');
--   * there is evidence of a PREVIOUS stint strictly older than
--     joined_at - 2 days (EVIDENCE MARGIN): an employee_career_events row
--     (effective_at), an attendance_logs row (timestamp), a checked-in
--     shift_assignments row (check_in_time), or an employee_contracts row
--     (created_at).
-- Why the margin: a first-stint employee's contract, assets, career entry
-- event and first face are written inside (or right after) the hire
-- transaction, so they sit seconds around joined_at (the app itself allows
-- 60 s, see employment-stint.utils.ts). Those employees can never match. A
-- PENDING job-application profile is created days before the hire, which is
-- why profile.created_at is deliberately NOT used as evidence. 2 days also
-- absorbs a possible app-clock vs database-clock time-zone skew (up to 7 h
-- for Asia/Ho_Chi_Minh), because joined_at is written by the app while
-- created_at defaults come from the database.
--
-- Row selection inside a rehired profile uses a separate ROW MARGIN of
-- 12 hours (row timestamp < joined_at - 12 h): rows of the current stint are
-- never that old, even with a time-zone skew. Trade-off: a terminate and
-- rehire within 12 h leaves that person's stale rows alone (use the app's
-- restore/rehire flow instead).
--
-- NOTE on contracts: deactivating an old contract can leave a rehired person
-- with NO active contract when the owner did not create a new one at rehire
-- (payroll then has no active contract, exactly as after a rehire through
-- the app). Report B lists `current_active_contracts` per profile; review
-- rows with 0 before applying.
--
-- HOW TO RUN (psql 10+, by hand; never from the app). Three modes:
--
--   PREVIEW (default, no variables): runs only the preflight and the
--   read-only report sections A-C, takes NO row locks, runs NO UPDATE, then
--   rolls back (only a session temp table is created).
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/cleanup_rehired_stale_stint.sql
--
--   DRY RUN (-v dryrun=1): also runs every fix statement, so the
--   "UPDATE n" / returned counts show exactly what WOULD change, then
--   ROLLBACK.
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v dryrun=1 -f scripts/cleanup_rehired_stale_stint.sql
--
--   APPLY (-v apply=1): runs the fix statements, then COMMIT.
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v apply=1 -f scripts/cleanup_rehired_stale_stint.sql
--
-- `apply` and `dryrun` are evaluated as psql booleans: only a true value
-- (1, true, on, yes) selects the mode; 0/false/off/no, or leaving the
-- variable out, does not. An unrecognised value (e.g. apply=maybe) is not a
-- boolean: psql reports it and treats it as false, or with ON_ERROR_STOP=1
-- stops the script; either way nothing is committed. apply wins over dryrun
-- when both are true.
--
-- Run DRY RUN and APPLY off-peak: they hold row locks on the affected
-- contracts, faces, asset assignments and assets until the transaction ends
-- (lock_timeout 5 s, so the script fails rather than queues if the rows are
-- busy). PREVIEW takes no row locks.
--
-- Idempotent: a second APPLY finds no active/ASSIGNED rows older than the
-- stint and changes 0 rows. Stock is restored only for assignment rows this
-- run actually moved from ASSIGNED to RETURNED under lock, so a concurrent
-- return by the owner is never restocked twice. Output contains ids and
-- counts only (no names, phones or other personal data).
-- =============================================

-- Normalise the mode variables: undefined -> false.
\if :{?apply}
\else
\set apply false
\endif
\if :{?dryrun}
\else
\set dryrun false
\endif
\if :apply
\set run_fix true
\echo 'MODE: APPLY (fix statements, then COMMIT)'
\elif :dryrun
\set run_fix true
\echo 'MODE: DRY RUN (fix statements, then ROLLBACK)'
\else
\set run_fix false
\echo 'MODE: PREVIEW (read-only reports, no locks, then ROLLBACK)'
\endif

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- Preflight: clock alignment. For recent first contracts written in the hire
-- transaction, (created_at - joined_at) should be a few seconds. Hours here
-- mean a time-zone skew; the margins above absorb up to 12 h, stop if larger.
SELECT current_setting('TimeZone') AS db_session_timezone,
       COUNT(*) AS recent_hire_contracts,
       MIN(EXTRACT(EPOCH FROM (c.created_at - p.joined_at)))::int AS min_skew_seconds,
       MAX(EXTRACT(EPOCH FROM (c.created_at - p.joined_at)))::int AS max_skew_seconds
  FROM employee_profiles p
  JOIN employee_contracts c ON c.employee_profile_id = p.id
 WHERE p.joined_at IS NOT NULL
   AND c.created_at BETWEEN p.joined_at - interval '1 day'
                        AND p.joined_at + interval '1 day';

CREATE TEMP TABLE rehired_stint ON COMMIT DROP AS
SELECT p.id AS profile_id,
       p.store_id,
       p.joined_at,
       EXISTS (SELECT 1 FROM employee_career_events e
                WHERE e.employee_profile_id = p.id
                  AND e.deleted_at IS NULL
                  AND e.effective_at < p.joined_at - interval '2 days')
         AS ev_career,
       EXISTS (SELECT 1 FROM attendance_logs l
                WHERE l.employee_profile_id = p.id
                  AND l."timestamp" < p.joined_at - interval '2 days')
         AS ev_attendance,
       EXISTS (SELECT 1 FROM shift_assignments sa
                WHERE sa.employee_id = p.id
                  AND sa.check_in_time IS NOT NULL
                  AND sa.check_in_time < p.joined_at - interval '2 days')
         AS ev_checkin,
       EXISTS (SELECT 1 FROM employee_contracts c
                WHERE c.employee_profile_id = p.id
                  AND c.created_at < p.joined_at - interval '2 days')
         AS ev_contract
  FROM employee_profiles p
 WHERE p.joined_at IS NOT NULL
   AND p.deleted_at IS NULL
   AND p.employment_status IN ('active', 'probation', 'on_leave');

DELETE FROM rehired_stint
 WHERE NOT (ev_career OR ev_attendance OR ev_checkin OR ev_contract);

-- =============================================
-- REPORTS A-C (every mode; read only, no row locks)
-- =============================================

-- A. How many profiles qualify, and on which evidence.
SELECT COUNT(*) AS rehired_profiles,
       COUNT(*) FILTER (WHERE ev_career) AS by_career_event,
       COUNT(*) FILTER (WHERE ev_attendance) AS by_attendance,
       COUNT(*) FILTER (WHERE ev_checkin) AS by_checkin,
       COUNT(*) FILTER (WHERE ev_contract) AS by_contract
  FROM rehired_stint;

-- B. Per profile: stale rows that would be closed, and what stays live.
SELECT r.profile_id,
       r.store_id,
       r.joined_at,
       r.ev_career, r.ev_attendance, r.ev_checkin, r.ev_contract,
       (SELECT COUNT(*) FROM employee_contracts c
         WHERE c.employee_profile_id = r.profile_id AND c.is_active = true
           AND c.created_at < r.joined_at - interval '12 hours')
         AS stale_active_contracts,
       (SELECT COUNT(*) FROM employee_contracts c
         WHERE c.employee_profile_id = r.profile_id AND c.is_active = true
           AND c.created_at >= r.joined_at - interval '12 hours')
         AS current_active_contracts,
       (SELECT COUNT(*) FROM employee_faces f
         WHERE f.employee_profile_id = r.profile_id AND f.is_active = true
           AND f.created_at < r.joined_at - interval '12 hours')
         AS stale_active_faces,
       (SELECT COUNT(*) FROM employee_faces f
         WHERE f.employee_profile_id = r.profile_id AND f.is_active = true
           AND f.created_at >= r.joined_at - interval '12 hours')
         AS current_active_faces,
       (SELECT COUNT(*) FROM employee_asset_assignments a
         WHERE a.employee_profile_id = r.profile_id AND a.status = 'ASSIGNED'
           AND a.deleted_at IS NULL
           AND a.assigned_date < r.joined_at - interval '12 hours')
         AS stale_assigned_assets
  FROM rehired_stint r
 ORDER BY r.store_id, r.profile_id;

-- C. Stock that would be restored per asset (own-store assets only).
SELECT a.asset_id,
       s.store_id AS asset_store_id,
       SUM(COALESCE(a.quantity, 0)) AS quantity_to_restock,
       BOOL_AND(s.store_id = r.store_id) AS restocked
  FROM employee_asset_assignments a
  JOIN rehired_stint r ON r.profile_id = a.employee_profile_id
  LEFT JOIN assets s ON s.id = a.asset_id
 WHERE a.status = 'ASSIGNED'
   AND a.deleted_at IS NULL
   AND a.assigned_date < r.joined_at - interval '12 hours'
 GROUP BY a.asset_id, s.store_id
 ORDER BY a.asset_id;

-- =============================================
-- FIX (DRY RUN and APPLY only; PREVIEW stops here)
-- =============================================
\if :run_fix

-- 1. Former-stint contracts -> inactive.
UPDATE employee_contracts c
   SET is_active = false,
       updated_at = now()
  FROM rehired_stint r
 WHERE c.employee_profile_id = r.profile_id
   AND c.is_active = true
   AND c.created_at < r.joined_at - interval '12 hours';

-- 2. Former-stint face registrations -> inactive.
UPDATE employee_faces f
   SET is_active = false,
       updated_at = now()
  FROM rehired_stint r
 WHERE f.employee_profile_id = r.profile_id
   AND f.is_active = true
   AND f.created_at < r.joined_at - interval '12 hours';

-- 3a. Candidate assignment rows (an unlocked snapshot; re-checked below).
CREATE TEMP TABLE stale_asset_assignments ON COMMIT DROP AS
SELECT a.id, a.asset_id, r.store_id
  FROM employee_asset_assignments a
  JOIN rehired_stint r ON r.profile_id = a.employee_profile_id
 WHERE a.status = 'ASSIGNED'
   AND a.deleted_at IS NULL
   AND a.assigned_date < r.joined_at - interval '12 hours';

-- 3b. Lock the assignment rows, then the assets in id order (the app's lock
--     order in resetFormerStintForRehire / assignInitialAssets).
SELECT a.id
  FROM employee_asset_assignments a
 WHERE a.id IN (SELECT id FROM stale_asset_assignments)
 ORDER BY a.id
   FOR UPDATE;

SELECT s.id
  FROM assets s
 WHERE s.id IN (SELECT asset_id FROM stale_asset_assignments)
 ORDER BY s.id
   FOR UPDATE;

-- 3c. Return the rows that are STILL assigned (under the locks above), and
--     restock own-store assets only from the rows this statement changed.
--     A row the owner returned meanwhile is not RETURNING-ed, so it is never
--     restocked twice; a rerun returns 0 rows and restocks nothing.
WITH ret AS (
  UPDATE employee_asset_assignments a
     SET status = 'RETURNED',
         returned_date = now(),
         return_note = 'Tự động thu hồi khi nhận lại nhân viên (kết thúc đợt làm việc trước)',
         updated_at = now()
    FROM stale_asset_assignments d
   WHERE a.id = d.id
     AND a.status = 'ASSIGNED'
     AND a.deleted_at IS NULL
  RETURNING a.id, a.asset_id, COALESCE(a.quantity, 0) AS quantity, d.store_id
), restock AS (
  UPDATE assets s
     SET current_stock = s.current_stock + q.quantity,
         updated_at = now()
    FROM (SELECT asset_id, store_id, SUM(quantity) AS quantity
            FROM ret
           GROUP BY asset_id, store_id) q
   WHERE s.id = q.asset_id
     AND s.store_id = q.store_id
  RETURNING s.id
)
SELECT (SELECT COUNT(*) FROM ret) AS returned_assignments,
       (SELECT COALESCE(SUM(quantity), 0) FROM ret) AS returned_quantity,
       (SELECT COUNT(*) FROM restock) AS restocked_assets;

-- Verification: must be 0 / 0 / 0 after the fix statements.
SELECT
  (SELECT COUNT(*) FROM employee_contracts c JOIN rehired_stint r
     ON r.profile_id = c.employee_profile_id
    WHERE c.is_active = true
      AND c.created_at < r.joined_at - interval '12 hours') AS remaining_contracts,
  (SELECT COUNT(*) FROM employee_faces f JOIN rehired_stint r
     ON r.profile_id = f.employee_profile_id
    WHERE f.is_active = true
      AND f.created_at < r.joined_at - interval '12 hours') AS remaining_faces,
  (SELECT COUNT(*) FROM employee_asset_assignments a JOIN rehired_stint r
     ON r.profile_id = a.employee_profile_id
    WHERE a.status = 'ASSIGNED' AND a.deleted_at IS NULL
      AND a.assigned_date < r.joined_at - interval '12 hours') AS remaining_assets;

\if :apply
\echo 'APPLY: committing'
    COMMIT;
\else
\echo 'DRY RUN: rolling back (re-run with -v apply=1 to commit)'
    ROLLBACK;
\endif
\else
\echo 'PREVIEW: no changes, no row locks; rolling back the temp table'
  ROLLBACK;
\endif
