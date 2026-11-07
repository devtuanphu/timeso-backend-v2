-- Nội quy & Tài liệu: mỗi cửa hàng có nhiều bài (nội quy hoặc tài liệu), áp dụng
-- cho toàn bộ hoặc một số bộ phận, có thời gian áp dụng, và tiến độ xem của từng
-- nhân viên. Trước đây mỗi cửa hàng chỉ có một nội quy (store_internal_rules);
-- bảng đó và API /internal-rule được giữ nguyên cho các bản app đã phát hành.
--
--   * store_documents.department_ids rỗng = tất cả nhân viên.
--   * content_revision tăng khi nội dung hoặc tệp đính kèm đổi: tiến độ xem của
--     bản cũ không còn được tính.
--   * store_document_views: tiến độ = viewed_parts / total_parts, total_parts là
--     số màn hình của bài trên máy nhân viên (app đo và gửi lên).
--
-- Nội quy cũ có nội dung được chép thành bài đầu tiên của cửa hàng (legacy_rule_id
-- giữ cho việc chạy lại không chép trùng).
--
-- Order: run BEFORE deploying the backend that serves these routes. Safe to
-- re-run. Additive only: không sửa hay xoá dữ liệu cũ.
--
-- Run: scripts/migrate.sh apply migration_store_documents.sql

\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS store_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  deleted_at timestamp,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  kind varchar(16) NOT NULL CHECK (kind IN ('RULE', 'DOCUMENT')),
  title varchar(255) NOT NULL,
  content text NOT NULL DEFAULT '',
  department_ids uuid[] NOT NULL DEFAULT '{}',
  valid_from date NOT NULL,
  valid_to date,
  stopped_at timestamp,
  content_revision int NOT NULL DEFAULT 1,
  files jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by_account_id uuid,
  created_by_name varchar(255),
  client_request_id varchar(64),
  legacy_rule_id uuid,
  CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

COMMENT ON TABLE store_documents IS
  'Nội quy và tài liệu của cửa hàng, áp dụng theo bộ phận và thời gian';

CREATE INDEX IF NOT EXISTS idx_store_documents_store
  ON store_documents (store_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- Gửi lại cùng một lần tạo (mạng chập chờn): không tạo bài thứ hai.
CREATE UNIQUE INDEX IF NOT EXISTS uq_store_documents_client_request
  ON store_documents (store_id, client_request_id)
  WHERE client_request_id IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_store_documents_legacy_rule
  ON store_documents (legacy_rule_id)
  WHERE legacy_rule_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS store_document_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  deleted_at timestamp,
  document_id uuid NOT NULL REFERENCES store_documents(id) ON DELETE CASCADE,
  employee_profile_id uuid NOT NULL REFERENCES employee_profiles(id) ON DELETE CASCADE,
  revision int NOT NULL,
  viewed_parts smallint NOT NULL,
  total_parts smallint NOT NULL,
  completed_at timestamp,
  CHECK (total_parts >= 1 AND viewed_parts >= 1 AND viewed_parts <= total_parts),
  CONSTRAINT uq_store_document_views_document_employee UNIQUE (document_id, employee_profile_id)
);

COMMENT ON TABLE store_document_views IS
  'Tiến độ xem nội quy / tài liệu của từng nhân viên, theo số màn hình đã xem';

CREATE INDEX IF NOT EXISTS idx_store_document_views_employee
  ON store_document_views (employee_profile_id);

INSERT INTO store_documents (
  store_id, kind, title, content, files, valid_from,
  created_at, updated_at, created_by_account_id, created_by_name, legacy_rule_id
)
SELECT
  r.store_id,
  'RULE',
  left(COALESCE(NULLIF(btrim(r.title), ''), 'Nội quy cửa hàng'), 255),
  COALESCE(r.content, ''),
  COALESCE(r.files, '[]'::jsonb),
  r.created_at::date,
  r.created_at,
  r.updated_at,
  s.owner_account_id,
  a.full_name,
  r.id
FROM store_internal_rules r
JOIN stores s ON s.id = r.store_id AND s.deleted_at IS NULL
LEFT JOIN accounts a ON a.id = s.owner_account_id
WHERE r.deleted_at IS NULL
  AND (
    btrim(COALESCE(r.content, '')) <> ''
    OR jsonb_array_length(COALESCE(r.files, '[]'::jsonb)) > 0
  )
ON CONFLICT (legacy_rule_id) WHERE legacy_rule_id IS NOT NULL DO NOTHING;

COMMIT;
