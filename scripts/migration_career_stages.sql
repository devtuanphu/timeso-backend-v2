-- Giai đoạn và đánh giá + hình thức làm việc.
--
-- 1. store_ladder_rungs.reviewer_profile_ids: người duyệt kết quả của một giai
--    đoạn. NULL / rỗng = chủ cửa hàng; có danh sách = các nhân viên đó được báo
--    khi có người đủ điều kiện (việc bấm duyệt vẫn do chủ).
-- 2. store_work_types: danh mục hình thức làm việc của cửa hàng (Toàn thời
--    gian, Bán thời gian…) — chỉ để phân loại, không ảnh hưởng lương / ca.
--    Bốn mục mặc định được tạo khi cửa hàng mở danh mục lần đầu (backend).
-- 3. employee_profiles.work_type_id: hình thức làm việc của nhân viên.
-- 4. Lộ trình giai đoạn (dimension employment_type): điều kiện chuyển là của
--    giai đoạn đang đứng ("ở Học việc đủ 30 ngày thì qua"), không còn nằm trên
--    giai đoạn đích. Dời store_rung_criteria của mỗi bậc đích về các bậc
--    trước nó. Bậc trước có nhiều nhánh mang điều kiện khác nhau thì lấy
--    nhánh có level nhỏ nhất (NOTICE liệt kê số bậc bị gộp như vậy). Điều kiện
--    của bậc điểm vào (không có bậc trước) bị bỏ — chúng chưa từng chặn ai.
--    store_ladders.criteria_on_source đánh dấu lộ trình đã dời, nên chạy lại
--    không dời thêm một bước nữa.
--
-- Order: run BEFORE deploying the backend that reads the new columns.
-- Safe to re-run. Additive only.
--
-- Run: scripts/migrate.sh apply migration_career_stages.sql

\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE store_ladder_rungs ADD COLUMN IF NOT EXISTS reviewer_profile_ids uuid[];

CREATE TABLE IF NOT EXISTS store_work_types (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  deleted_at timestamp,
  store_id uuid NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  name varchar(100) NOT NULL,
  description varchar(255),
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_store_work_types_store_name
  ON store_work_types (store_id, lower(name)) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_store_work_types_store ON store_work_types (store_id);

ALTER TABLE employee_profiles ADD COLUMN IF NOT EXISTS work_type_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'employee_profiles'::regclass AND conname = 'fk_employee_profiles_work_type'
  ) THEN
    ALTER TABLE employee_profiles ADD CONSTRAINT fk_employee_profiles_work_type
      FOREIGN KEY (work_type_id) REFERENCES store_work_types (id) ON DELETE SET NULL;
  END IF;
END $$;

-- 4. Dời điều kiện của lộ trình giai đoạn ------------------------------------

ALTER TABLE store_ladders ADD COLUMN IF NOT EXISTS criteria_on_source boolean NOT NULL DEFAULT false;
-- Lộ trình tạo sau migration này sinh ra với nghĩa mới.
ALTER TABLE store_ladders ALTER COLUMN criteria_on_source SET DEFAULT true;

CREATE TEMP TABLE _stage_ladders ON COMMIT DROP AS
  SELECT id FROM store_ladders
   WHERE dimension = 'employment_type' AND NOT criteria_on_source;

-- Mỗi bậc nguồn P nhận điều kiện của đúng một bậc đích T (level nhỏ nhất có
-- điều kiện) trong số các cạnh P -> T.
CREATE TEMP TABLE _stage_moves ON COMMIT DROP AS
  SELECT DISTINCT ON (e.from_rung_id)
         e.from_rung_id AS source_rung_id,
         e.to_rung_id   AS target_rung_id,
         COUNT(*) OVER (PARTITION BY e.from_rung_id) AS branches
    FROM store_ladder_edges e
    JOIN _stage_ladders l ON l.id = e.ladder_id
    JOIN store_ladder_rungs t ON t.id = e.to_rung_id AND t.deleted_at IS NULL
    JOIN store_ladder_rungs s ON s.id = e.from_rung_id AND s.deleted_at IS NULL
   WHERE e.from_rung_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM store_rung_criteria c
                  WHERE c.rung_id = e.to_rung_id AND c.deleted_at IS NULL)
   ORDER BY e.from_rung_id, t.level, t.id;

DO $$
DECLARE merged int;
BEGIN
  SELECT COUNT(*) INTO merged FROM _stage_moves WHERE branches > 1;
  IF merged > 0 THEN
    RAISE NOTICE 'migration_career_stages: % bậc nguồn có nhiều nhánh mang điều kiện, đã lấy nhánh level nhỏ nhất', merged;
  END IF;
END $$;

CREATE TEMP TABLE _stage_old ON COMMIT DROP AS
  SELECT c.*
    FROM store_rung_criteria c
    JOIN store_ladder_rungs r ON r.id = c.rung_id
    JOIN _stage_ladders l ON l.id = r.ladder_id
   WHERE c.deleted_at IS NULL;

DELETE FROM store_rung_criteria c USING _stage_old o WHERE c.id = o.id;

INSERT INTO store_rung_criteria
  (id, created_at, updated_at, rung_id, kind, code, operator, value, label, unit, is_required, sort_order)
SELECT uuid_generate_v4(), now(), now(), m.source_rung_id,
       o.kind, o.code, o.operator, o.value, o.label, o.unit, o.is_required, o.sort_order
  FROM _stage_moves m
  JOIN _stage_old o ON o.rung_id = m.target_rung_id;

UPDATE store_ladders SET criteria_on_source = true
 WHERE id IN (SELECT id FROM _stage_ladders);

COMMIT;
