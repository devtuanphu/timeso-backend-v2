-- =============================================
-- Migration: Scoped request approvers — PHASE 2 follow-ups (R1 + R2)
--
-- R1 "Vị trí ứng tuyển": snapshot the applied position/department on a job
--     application so a `job_application` approver can be scoped by dept/position
--     (an application with a null applied_position_id stays owner-only).
-- R2 "Được xem lý do đơn": a per-approver flag controlling whether a scoped
--     approver may see the employee's free-text reason/note/requestReason. The
--     safe closed default is FALSE (reasons hidden).
--
-- Additive and idempotent (managed mode, synchronize OFF). Apply BEFORE code.
-- Builds on scripts/migration_store_request_approvers.sql (phase 1).
--
-- ROLLOUT NOTE (non-additive behavior change shipping with this code, not with
-- this schema): rejecting a salary advance now REQUIRES a non-empty reviewNote
-- server-side (400 SALARY_ADVANCE_REJECT_NOTE_REQUIRED). A client that rejects
-- without a reason starts failing. Deploy the backend together with the owner
-- and staff OTA so both apps send a reason on reject.
-- =============================================

-- R1 — applied position/department snapshot. No FK on these columns on purpose
-- (snapshot semantics, mirroring the uuid-without-FK choice of the scope
-- arrays): a hard-deleted role must leave the historical application untouched,
-- and apply-time validation already enforces store + active.
ALTER TABLE store_job_applications
    ADD COLUMN IF NOT EXISTS applied_position_id UUID,
    ADD COLUMN IF NOT EXISTS applied_department_id UUID;

CREATE INDEX IF NOT EXISTS idx_job_applications_applied_position
    ON store_job_applications(applied_position_id)
    WHERE deleted_at IS NULL AND applied_position_id IS NOT NULL;

-- R2 — per-approver "can view reasons". Existing rows default to FALSE, so every
-- pre-existing approver has reasons hidden until the owner explicitly grants it.
ALTER TABLE store_request_approvers
    ADD COLUMN IF NOT EXISTS can_view_reasons BOOLEAN NOT NULL DEFAULT FALSE;

-- =============================================
-- Rollback (schema is additive; leave in place unless a hard rollback is needed)
-- =============================================
-- ALTER TABLE store_job_applications
--   DROP COLUMN IF EXISTS applied_position_id,
--   DROP COLUMN IF EXISTS applied_department_id;
-- ALTER TABLE store_request_approvers DROP COLUMN IF EXISTS can_view_reasons;
