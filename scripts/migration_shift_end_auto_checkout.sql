BEGIN;

ALTER TYPE attendance_logs_method_enum ADD VALUE IF NOT EXISTS 'SYSTEM';
ALTER TYPE notifications_type_enum ADD VALUE IF NOT EXISTS 'Nhắc chấm công ra';
ALTER TYPE notifications_type_enum ADD VALUE IF NOT EXISTS 'Tự động kết thúc ca';
ALTER TYPE notifications_type_enum ADD VALUE IF NOT EXISTS 'Trạng thái tăng ca';

ALTER TABLE shift_assignments
  ADD COLUMN IF NOT EXISTS is_auto_checkout boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_checkout_reason varchar,
  ADD COLUMN IF NOT EXISTS scheduled_checkout_time timestamptz;

ALTER TABLE bonus_work_requests
  ADD COLUMN IF NOT EXISTS shift_assignment_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_bonus_work_requests_shift_assignment'
  ) THEN
    ALTER TABLE bonus_work_requests
      ADD CONSTRAINT fk_bonus_work_requests_shift_assignment
      FOREIGN KEY (shift_assignment_id) REFERENCES shift_assignments(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bonus_work_requests_shift_assignment
  ON bonus_work_requests (shift_assignment_id)
  WHERE deleted_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'shift_end_workflows_state_enum') THEN
    CREATE TYPE shift_end_workflows_state_enum AS ENUM (
      'ACTIVE',
      'OVERTIME_PENDING',
      'OVERTIME_APPROVED',
      'COMPLETED_BY_EMPLOYEE',
      'AUTO_COMPLETED',
      'CANCELLED'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS shift_end_workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  shift_assignment_id uuid NOT NULL,
  scheduled_end_at timestamptz NOT NULL,
  effective_end_at timestamptz NOT NULL,
  state shift_end_workflows_state_enum NOT NULL DEFAULT 'ACTIVE',
  reminder_0_sent_at timestamptz,
  reminder_5_sent_at timestamptz,
  reminder_10_sent_at timestamptz,
  auto_checkout_at timestamptz,
  overtime_request_id uuid,
  last_error text,
  CONSTRAINT uq_shift_end_workflows_assignment UNIQUE (shift_assignment_id),
  CONSTRAINT fk_shift_end_workflows_assignment
    FOREIGN KEY (shift_assignment_id) REFERENCES shift_assignments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_shift_end_workflows_due
  ON shift_end_workflows (state, effective_end_at)
  WHERE deleted_at IS NULL;

COMMIT;
