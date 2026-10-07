-- Note 10: the store's payslip template ("Thiết lập tính lương" → bảng lương
-- chi tiết nhân viên nhìn thấy).
--   * store_payslip_rows: renamed / removed built-in rows (Phụ cấp, Thưởng,
--     Khấu trừ) and the owner's extra PLUS / MINUS lines.
--   * employee_salaries.payslip_rows: the template a payslip was computed with.
--
-- Order: run BEFORE deploying the backend that reads these (TypeORM selects
-- every mapped column). Additive and safe to re-run; the old backend ignores
-- them.
--
-- Run: psql ... -v ON_ERROR_STOP=1 -f scripts/migration_note10.sql

\set ON_ERROR_STOP on

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'store_payslip_rows_builtin_key_enum') THEN
    CREATE TYPE store_payslip_rows_builtin_key_enum AS ENUM ('ALLOWANCE', 'BONUS', 'DEDUCTION');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'store_payslip_rows_sign_enum') THEN
    CREATE TYPE store_payslip_rows_sign_enum AS ENUM ('PLUS', 'MINUS');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS store_payslip_rows (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  deleted_at timestamp NULL,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  builtin_key store_payslip_rows_builtin_key_enum NULL,
  label varchar(80) NOT NULL,
  sign store_payslip_rows_sign_enum NOT NULL DEFAULT 'PLUS',
  amount numeric(12,2) NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS ix_store_payslip_rows_store ON store_payslip_rows (store_id);
-- One stored row per built-in row of a store.
CREATE UNIQUE INDEX IF NOT EXISTS ux_store_payslip_rows_builtin
  ON store_payslip_rows (store_id, builtin_key)
  WHERE builtin_key IS NOT NULL;

ALTER TABLE employee_salaries
  ADD COLUMN IF NOT EXISTS payslip_rows jsonb NULL;

COMMIT;

-- Verify
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_name = 'store_payslip_rows'
 ORDER BY ordinal_position;
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_name = 'employee_salaries' AND column_name = 'payslip_rows';
