-- =============================================
-- Migration: Add Shift Change and Bonus Work Request tables
-- Created: 2026-04-19
-- =============================================

-- 1. Shift Change Requests Table
CREATE TABLE IF NOT EXISTS shift_change_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL,
    employee_profile_id UUID NOT NULL,
    current_shift_id UUID,
    requested_shift_id UUID,
    request_date DATE NOT NULL,
    reason TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    approved_by_id UUID,
    rejection_reason TEXT,
    attachments TEXT[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE,

    CONSTRAINT fk_shift_change_store FOREIGN KEY (store_id)
        REFERENCES stores(id) ON DELETE CASCADE,
    CONSTRAINT fk_shift_change_employee FOREIGN KEY (employee_profile_id)
        REFERENCES employee_profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_shift_change_approver FOREIGN KEY (approved_by_id)
        REFERENCES employee_profiles(id) ON DELETE SET NULL,
    CONSTRAINT chk_shift_change_status CHECK (
        status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')
    )
);

-- 2. Bonus Work Requests Table
CREATE TABLE IF NOT EXISTS bonus_work_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID NOT NULL,
    employee_profile_id UUID NOT NULL,
    shift_slot_id UUID,
    request_date DATE NOT NULL,
    start_time TIME,
    end_time TIME,
    reason TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    approved_by_id UUID,
    rejection_reason TEXT,
    attachments TEXT[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE,

    CONSTRAINT fk_bonus_work_store FOREIGN KEY (store_id)
        REFERENCES stores(id) ON DELETE CASCADE,
    CONSTRAINT fk_bonus_work_employee FOREIGN KEY (employee_profile_id)
        REFERENCES employee_profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_bonus_work_approver FOREIGN KEY (approved_by_id)
        REFERENCES employee_profiles(id) ON DELETE SET NULL,
    CONSTRAINT chk_bonus_work_status CHECK (
        status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')
    )
);

-- 3. Indexes for performance
CREATE INDEX IF NOT EXISTS idx_shift_change_employee
    ON shift_change_requests(employee_profile_id);

CREATE INDEX IF NOT EXISTS idx_shift_change_store
    ON shift_change_requests(store_id);

CREATE INDEX IF NOT EXISTS idx_shift_change_status
    ON shift_change_requests(status);

CREATE INDEX IF NOT EXISTS idx_shift_change_date
    ON shift_change_requests(request_date);

CREATE INDEX IF NOT EXISTS idx_bonus_work_employee
    ON bonus_work_requests(employee_profile_id);

CREATE INDEX IF NOT EXISTS idx_bonus_work_store
    ON bonus_work_requests(store_id);

CREATE INDEX IF NOT EXISTS idx_bonus_work_status
    ON bonus_work_requests(status);

CREATE INDEX IF NOT EXISTS idx_bonus_work_date
    ON bonus_work_requests(request_date);

-- =============================================
-- Rollback Script (if needed)
-- =============================================
-- DROP TABLE IF EXISTS shift_change_requests;
-- DROP TABLE IF EXISTS bonus_work_requests;
