-- Phase 3 / C: career-ladder entry events and probation end dates for
-- existing staff.
--
-- Hiring wrote no employee_career_events row, so "days in rung" measured 0
-- for everyone hired after migration_career_ladders.sql, and probation never
-- ended. The API now records an entry event at hire (recordEntryCareerEvents)
-- and derives the probation end from the next rung's required days_in_rung
-- (computeProbationEndsAt). This script applies the same rules to rows that
-- already exist.
--
-- Order: deploy the backend first, then run this once. Apply by hand through
-- psql (no TypeORM migration runner; DATABASE_SCHEMA_MODE=managed).
--
-- Preflight: both columns compared below must be `timestamp without time
-- zone` (they are in migration_career_ladders.sql and the entities):
--   \d employee_profiles        -- joined_at
--   \d employee_career_events   -- effective_at
--
-- Safe to re-run: the insert skips any profile/ladder that already has an
-- event at or after the hire date, and the update only fills
-- probation_ends_at where it is NULL. A second run changes 0 rows.
--
-- Effect: no automatic promotion. Probation only auto-advances when the next
-- rung is approval=auto with no checklist; migrated "Chính thức" rungs need
-- owner approval, so the nightly job notifies the owner instead.

BEGIN;

-- 1. One entry event per active ladder on whose rung each working employee
--    sits, dated at the hire.
INSERT INTO employee_career_events
  (employee_profile_id, ladder_id, from_rung_id, to_rung_id, effective_at, note)
SELECT p.id, l.id, NULL, r.id, COALESCE(p.joined_at, p.created_at),
       'Bổ sung mốc vào bậc khi tuyển'
  FROM employee_profiles p
  JOIN store_ladders l
    ON l.store_id = p.store_id AND l.deleted_at IS NULL AND l.is_active = true
  JOIN store_ladder_rungs r
    ON r.ladder_id = l.id AND r.deleted_at IS NULL
   AND r.target_id = CASE l.dimension
                       WHEN 'employment_type' THEN p.employee_type_id
                       WHEN 'position' THEN p.store_role_id
                       WHEN 'skill' THEN p.skill_id
                     END
 WHERE p.deleted_at IS NULL
   AND p.employment_status IN ('active', 'probation', 'on_leave')
   AND NOT EXISTS (
     SELECT 1 FROM employee_career_events e
      WHERE e.employee_profile_id = p.id
        AND e.ladder_id = l.id
        AND e.deleted_at IS NULL
        AND e.effective_at >= COALESCE(p.joined_at, p.created_at)
   );

-- 2. Probation end for people still on probation without one: entry into the
--    probation rung + the smallest required days_in_rung on the next rungs,
--    else the probation rung's own days_in_rung.
WITH cur AS (
  SELECT p.id AS pid, r.id AS rid,
         (SELECT MAX(e.effective_at)
            FROM employee_career_events e
           WHERE e.employee_profile_id = p.id
             AND e.ladder_id = l.id
             AND e.deleted_at IS NULL) AS entered
    FROM employee_profiles p
    JOIN store_ladders l
      ON l.store_id = p.store_id AND l.dimension = 'employment_type'
     AND l.deleted_at IS NULL AND l.is_active = true
    JOIN store_ladder_rungs r
      ON r.ladder_id = l.id AND r.target_id = p.employee_type_id
     AND r.deleted_at IS NULL
   WHERE p.deleted_at IS NULL
     AND p.employment_status = 'probation'
     AND p.probation_ends_at IS NULL
),
d AS (
  SELECT cur.pid, cur.entered,
         COALESCE(
           (SELECT MIN(c.value)
              FROM store_ladder_edges ed
              JOIN store_rung_criteria c ON c.rung_id = ed.to_rung_id
             WHERE ed.from_rung_id = cur.rid
               AND ed.deleted_at IS NULL
               AND c.deleted_at IS NULL
               AND c.kind = 'tenure'
               AND c.code = 'days_in_rung'
               AND c.is_required),
           (SELECT MIN(c.value)
              FROM store_rung_criteria c
             WHERE c.rung_id = cur.rid
               AND c.deleted_at IS NULL
               AND c.kind = 'tenure'
               AND c.code = 'days_in_rung')
         ) AS days
    FROM cur
)
UPDATE employee_profiles p
   SET probation_ends_at = d.entered + (d.days * INTERVAL '1 day')
  FROM d
 WHERE p.id = d.pid
   AND d.days > 0
   AND d.entered IS NOT NULL
   AND p.probation_ends_at IS NULL;

COMMIT;
