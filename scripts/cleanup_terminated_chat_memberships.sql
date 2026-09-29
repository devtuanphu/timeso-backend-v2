-- X4: remove stale store group-chat memberships of people who no longer work
-- at the store (terminated, or never hired: pending applicant).
--
-- Termination (StoresService.deleteEmployee) did not touch chat_group_members,
-- so ex-employees kept an `active` membership in the store's group chats and
-- still appeared in GET /chat-groups/:id/members. The API now removes those
-- memberships inside the termination transaction and hides non-employed
-- members from member lists. This script repairs rows written before that.
--
-- Scope mirrors the API (StoresService.removeStoreGroupChatMemberships):
--   * only `active`, non-deleted memberships of non-deleted group chats;
--   * direct chats (direct_key IS NOT NULL) are kept as history;
--   * groups the account itself created are kept;
--   * the store owner is never touched;
--   * a member is stale when they have NO non-deleted profile at the group's
--     store with employment_status IN ('active', 'probation', 'on_leave').
--
-- Order: deploy the backend first (so no new stale rows appear), then run.
-- Apply by hand through psql (no TypeORM migration runner).
-- Safe to re-run: only rows still `active` are updated; a second run changes
-- 0 rows. Rows are marked `removed` (never deleted), matching the rehire path.

-- 1. DRY RUN: inspect first. Count per store, then the affected rows.
SELECT g.store_id, COUNT(*) AS stale_memberships
  FROM chat_group_members m
  JOIN chat_groups g
    ON g.id = m.group_id
   AND g.deleted_at IS NULL
   AND g.direct_key IS NULL
  JOIN stores s ON s.id = g.store_id
 WHERE m.status = 'active'
   AND m.deleted_at IS NULL
   AND m.account_id <> s.owner_account_id
   AND m.account_id <> g.created_by
   AND NOT EXISTS (
     SELECT 1 FROM employee_profiles p
      WHERE p.store_id = g.store_id
        AND p.account_id = m.account_id
        AND p.deleted_at IS NULL
        AND p.employment_status IN ('active', 'probation', 'on_leave')
   )
 GROUP BY g.store_id
 ORDER BY stale_memberships DESC;

-- SELECT m.id, m.group_id, m.account_id, g.store_id
--   FROM chat_group_members m
--   JOIN chat_groups g ON g.id = m.group_id AND g.deleted_at IS NULL AND g.direct_key IS NULL
--   JOIN stores s ON s.id = g.store_id
--  WHERE m.status = 'active' AND m.deleted_at IS NULL
--    AND m.account_id <> s.owner_account_id AND m.account_id <> g.created_by
--    AND NOT EXISTS (
--      SELECT 1 FROM employee_profiles p
--       WHERE p.store_id = g.store_id AND p.account_id = m.account_id
--         AND p.deleted_at IS NULL
--         AND p.employment_status IN ('active', 'probation', 'on_leave'))
--  ORDER BY g.store_id, m.group_id;

-- 2. APPLY.
BEGIN;

UPDATE chat_group_members m
   SET status = 'removed',
       updated_at = NOW()
  FROM chat_groups g, stores s
 WHERE g.id = m.group_id
   AND g.deleted_at IS NULL
   AND g.direct_key IS NULL
   AND s.id = g.store_id
   AND m.status = 'active'
   AND m.deleted_at IS NULL
   AND m.account_id <> s.owner_account_id
   AND m.account_id <> g.created_by
   AND NOT EXISTS (
     SELECT 1 FROM employee_profiles p
      WHERE p.store_id = g.store_id
        AND p.account_id = m.account_id
        AND p.deleted_at IS NULL
        AND p.employment_status IN ('active', 'probation', 'on_leave')
   );

COMMIT;

-- 3. VERIFY: re-running the dry-run query in step 1 must return no rows.
