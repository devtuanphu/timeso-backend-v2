-- Lộ trình v2: kỹ năng có thể gắn với một vị trí của bộ phận.
--
-- store_skills.position_id: NULL = kỹ năng chung của bộ phận (mọi kỹ năng hiện
-- có giữ nguyên nghĩa cũ); có giá trị = chỉ nhân viên đang giữ vị trí đó phải
-- học. Vị trí phải cùng bộ phận với kỹ năng — kiểm ở backend
-- (career-structure.service.ts skillPosition); FK dưới đây chỉ bảo đảm cùng
-- cửa hàng.
--
-- Order: run BEFORE deploying the backend that reads the new column (TypeORM
-- selects every mapped column).
-- Safe to re-run. Additive only.
--
-- Run: scripts/migrate.sh apply migration_career_skill_position.sql

\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION pg_temp.career_add_constraint(tbl regclass, cname text, ddl text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = tbl AND conname = cname) THEN
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', tbl, cname, ddl);
  END IF;
END $$;

ALTER TABLE store_skills ADD COLUMN IF NOT EXISTS position_id uuid;

-- Cùng mẫu fk_career_requirements_position: (store_id, id) của store_roles là UNIQUE.
SELECT pg_temp.career_add_constraint('store_skills', 'fk_store_skills_position',
  'FOREIGN KEY (store_id, position_id) REFERENCES store_roles (store_id, id)');

CREATE INDEX IF NOT EXISTS ix_store_skills_position
  ON store_skills (position_id) WHERE position_id IS NOT NULL;

COMMIT;
