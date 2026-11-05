-- Lộ trình v2: kỹ năng "không theo thứ tự".
--
-- store_skills.is_ordered: true (mặc định — mọi kỹ năng hiện có giữ nguyên
-- nghĩa cũ) = mở khoá tuần tự, kỹ năng bắt buộc chưa đạt khoá các kỹ năng
-- đứng sau; false = mở ngay từ lúc nhân viên vào bộ phận / nhận vị trí,
-- không chờ kỹ năng trước và cũng không khoá kỹ năng sau
-- (career-evaluation.service.ts skillStates).
--
-- Order: run BEFORE deploying the backend that reads the new column (TypeORM
-- selects every mapped column). Safe to re-run. Additive only.
--
-- Run: scripts/migrate.sh apply migration_career_skill_unordered.sql

\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE store_skills
  ADD COLUMN IF NOT EXISTS is_ordered boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN store_skills.is_ordered IS
  'false = kỹ năng không theo thứ tự: mở ngay, không chờ và không khoá kỹ năng khác';

COMMIT;
