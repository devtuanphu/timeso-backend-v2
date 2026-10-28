-- Đơn giá lương theo ca / vị trí / khung giờ (Thiết lập tính lương).
--
-- Mỗi hàng: đơn vị (HOUR đồng/giờ, SHIFT đồng/ca), số tiền, các ca áp dụng
-- (work_shift_ids, trống = mọi ca), các vị trí áp dụng (role_ids → store_roles,
-- trống = mọi vị trí), khung giờ trong ngày giờ VN (time_from / time_to, cả hai
-- NULL = cả ngày; time_to <= time_from = qua nửa đêm). Luật chọn đơn giá ở
-- src/modules/stores/wage-rates.utils.ts.
--
-- Chưa có hàng nào thì lương tính y như trước (lương hợp đồng).
--
-- Thứ tự: chạy TRƯỚC khi deploy backend đọc bảng này. Chỉ thêm mới, chạy lại
-- được.
--
-- Run: scripts/migrate.sh apply migration_wage_rates.sql

\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS store_wage_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  deleted_at timestamp,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name varchar(80),
  unit varchar(10) NOT NULL CHECK (unit IN ('HOUR', 'SHIFT')),
  amount numeric(12, 2) NOT NULL CHECK (amount > 0),
  work_shift_ids uuid[] NOT NULL DEFAULT '{}',
  role_ids uuid[] NOT NULL DEFAULT '{}',
  time_from time,
  time_to time,
  sort_order int NOT NULL DEFAULT 0,
  CONSTRAINT chk_store_wage_rates_window CHECK (
    (time_from IS NULL AND time_to IS NULL)
    OR (time_from IS NOT NULL AND time_to IS NOT NULL AND time_from <> time_to AND unit = 'HOUR')
  )
);

CREATE INDEX IF NOT EXISTS idx_store_wage_rates_store
  ON store_wage_rates (store_id) WHERE deleted_at IS NULL;

COMMIT;
