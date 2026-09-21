-- Chat riêng 1-1 giữa hai thành viên cùng cửa hàng.
-- Một nhóm chat thường có direct_key = NULL. Chat riêng có
-- direct_key = '<store_id>:<account nhỏ hơn>:<account lớn hơn>', duy nhất,
-- để hai người luôn mở lại đúng một cuộc chat.
-- Additive, chạy lại an toàn; chạy TRƯỚC khi deploy code dùng cột này
-- (TypeORM đọc cột direct_key trong mọi truy vấn chat_groups).
-- KHÔNG chạy trong transaction (không dùng psql -1): CREATE INDEX CONCURRENTLY.
-- Sau khi chạy: psql -f scripts/verify_chat_direct.sql
-- Rollback khẩn cấp: DROP INDEX CONCURRENTLY IF EXISTS uq_chat_groups_direct_key;
--   KHÔNG xoá cột direct_key khi đã có chat riêng (chúng sẽ thành nhóm hai
--   người tên "Chat riêng").
\set ON_ERROR_STOP on
SET lock_timeout = '3s';
ALTER TABLE chat_groups ADD COLUMN IF NOT EXISTS direct_key varchar(200);

-- Một lần chạy CONCURRENTLY bị ngắt giữa chừng để lại chỉ mục INVALID;
-- IF NOT EXISTS sẽ bỏ qua nó và ràng buộc duy nhất âm thầm không có hiệu lực.
-- Dừng lại để người vận hành xoá rồi chạy lại.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class index_class
    JOIN pg_index index_state ON index_state.indexrelid = index_class.oid
    JOIN pg_namespace schema_row ON schema_row.oid = index_class.relnamespace
    WHERE index_class.relname = 'uq_chat_groups_direct_key'
      AND schema_row.nspname = current_schema()
      AND index_state.indisvalid = false
  ) THEN
    RAISE EXCEPTION 'uq_chat_groups_direct_key is INVALID: run DROP INDEX CONCURRENTLY IF EXISTS uq_chat_groups_direct_key; then rerun this script';
  END IF;
END $$;

-- Chỉ mục duy nhất sẽ thất bại (và CONCURRENTLY để lại chỉ mục INVALID) nếu đã
-- có hai chat riêng đang hoạt động cùng direct_key. Kiểm tra trước và dừng với
-- hướng dẫn tìm bản trùng; người vận hành xử lý dữ liệu rồi chạy lại.
DO $$
DECLARE
  duplicate_key_count integer;
BEGIN
  SELECT count(*) INTO duplicate_key_count
  FROM (
    SELECT direct_key
    FROM chat_groups
    WHERE direct_key IS NOT NULL AND deleted_at IS NULL
    GROUP BY direct_key
    HAVING count(*) > 1
  ) duplicate_keys;
  IF duplicate_key_count > 0 THEN
    RAISE EXCEPTION 'chat_groups has % direct_key value(s) shared by more than one active (deleted_at IS NULL) group; uq_chat_groups_direct_key was NOT created', duplicate_key_count
      USING HINT = 'Find them with: SELECT direct_key, array_agg(id ORDER BY created_at) AS group_ids, count(*) FROM chat_groups WHERE direct_key IS NOT NULL AND deleted_at IS NULL GROUP BY direct_key HAVING count(*) > 1; resolve each duplicate (keep one active group per direct_key), then rerun this script.';
  END IF;
END $$;

\set AUTOCOMMIT on
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_chat_groups_direct_key
  ON chat_groups (direct_key)
  WHERE direct_key IS NOT NULL AND deleted_at IS NULL;
