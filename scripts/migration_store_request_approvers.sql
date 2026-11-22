-- =============================================
-- Migration: Scoped request approvers ("Cài đặt người phê duyệt")
-- Adds store_request_approvers: an owner delegates a chosen set of request
-- types (optionally narrowed by department / position / skill) to one employee.
-- Additive and idempotent (managed mode, synchronize OFF). Apply BEFORE code.
-- =============================================

CREATE TABLE IF NOT EXISTS store_request_approvers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL,
    employee_profile_id UUID NOT NULL,
    -- Empty array = all. No FK on the scope arrays on purpose: a deleted
    -- department / position / skill id must stop matching (fail-closed narrow),
    -- not cascade-empty the dimension into "tất cả" (privilege escalation).
    request_types TEXT[] NOT NULL DEFAULT '{}',
    department_ids UUID[] NOT NULL DEFAULT '{}',
    position_ids UUID[] NOT NULL DEFAULT '{}',
    skill_ids UUID[] NOT NULL DEFAULT '{}',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE,

    CONSTRAINT fk_store_request_approvers_store FOREIGN KEY (store_id)
        REFERENCES stores(id) ON DELETE CASCADE,
    CONSTRAINT fk_store_request_approvers_employee FOREIGN KEY (employee_profile_id)
        REFERENCES employee_profiles(id) ON DELETE CASCADE
);

-- CHECK on the allowed request-type strings. Guarded so a re-run does not fail
-- on the already-present constraint.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_store_request_approvers_types'
    ) THEN
        ALTER TABLE store_request_approvers
            ADD CONSTRAINT chk_store_request_approvers_types CHECK (
                request_types <@ ARRAY[
                    'shift_registration','shift_change','custom_shift','leave',
                    'late','early','bonus_work','salary_advance','kpi','job_application'
                ]::text[]
            );
    END IF;
END $$;

-- One active delegation row per (store, employee); a soft-deleted row can be
-- replaced by a fresh one.
CREATE UNIQUE INDEX IF NOT EXISTS ux_store_request_approvers_store_employee
    ON store_request_approvers(store_id, employee_profile_id)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_store_request_approvers_store
    ON store_request_approvers(store_id)
    WHERE deleted_at IS NULL;

-- =============================================
-- Rollback (schema is additive; leave in place unless a hard rollback is needed)
-- =============================================
-- DROP TABLE IF EXISTS store_request_approvers;
