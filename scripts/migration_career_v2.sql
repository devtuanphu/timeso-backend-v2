-- Lộ trình thăng tiến v2: Bộ phận · Vị trí · Kỹ năng
-- (plan: docs/plans/2026-10-13-career-ladder-v2.md, …-v2-impl.md ở workspace).
--
-- Thay đồ thị lộ trình chung (store_ladders → rungs → edges, target_id không
-- có khoá ngoại) bằng bảng nghiệp vụ có khoá ngoại thật cho vị trí và kỹ năng.
-- Lộ trình Thử việc → Chính thức (dimension employment_type) giữ nguyên.
--
--   * store_departments            cây bộ phận Cấp 1–4 (Cấp 1 = "Chủ cửa hàng", do hệ thống tạo)
--   * store_roles (= Vị trí)       + department_id, rank (thấp → cao trong bộ phận)
--   * store_skills                 + department_id, sequence, level (required|optional),
--                                    confirmation (manager = chủ/quản lý xác nhận | auto = tự đạt khi đủ điều kiện)
--   * career_requirements          điều kiện để VÀO một bộ phận / vị trí / kỹ năng
--   * employee_profiles            + department_id (skill_id giữ lại cho app cũ đọc)
--   * employee_skill_progress      kỹ năng đã mở khoá / đã đạt của từng nhân viên
--   * employee_skill_evaluations   từng lần chấm Đạt / Không đạt
--   * employee_career_events       + subject_type, from/to_target_id, client_request_id;
--                                    ladder_id / to_rung_id cho phép null
--   * store_career_settings        nhắc kiểm duyệt + cờ v2_enabled theo cửa hàng
--
-- Mọi bảng mới mang store_id và tham chiếu bằng khoá ngoại kép (store_id, id):
-- cơ sở dữ liệu tự chặn mọi tham chiếu sang cửa hàng khác (SaaS-1).
--
-- Thứ tự triển khai: chạy TRƯỚC khi deploy backend mới (TypeORM select mọi cột
-- đã map). Chỉ thêm; backend cũ bỏ qua cột mới, và cột cũ bị nới NOT NULL chỉ
-- được backend mới ghi null. Chạy lại được: lần hai không đổi gì.
--
-- Bật lộ trình mới cho một cửa hàng: scripts/career_v2_enable_store.sql (chạy
-- lại phần chuyển dữ liệu cho cửa hàng đó và bật cờ trong cùng transaction).
-- Tắt cờ KHÔNG trả về trạng thái cũ sạch sẽ: sự kiện / tiến độ ghi theo v2
-- không hiện trên màn lộ trình cũ.
--
-- Chạy: psql ... -v ON_ERROR_STOP=1 -f scripts/migration_career_v2.sql

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Báo cáo trước khi chạy
-- ---------------------------------------------------------------------------
SELECT 'before' AS phase,
       (SELECT count(*) FROM stores WHERE deleted_at IS NULL) AS stores,
       (SELECT count(*) FROM store_roles WHERE deleted_at IS NULL) AS positions,
       (SELECT count(*) FROM store_skills WHERE deleted_at IS NULL) AS skills,
       (SELECT count(*) FROM employee_profiles WHERE deleted_at IS NULL) AS profiles,
       (SELECT count(*) FROM employee_profiles WHERE deleted_at IS NULL AND store_role_id IS NOT NULL) AS profiles_with_position,
       (SELECT count(*) FROM employee_profiles WHERE deleted_at IS NULL AND skill_id IS NOT NULL) AS profiles_with_skill;

BEGIN;
SET LOCAL lock_timeout = '5s';
-- Cột `timestamp` lưu giờ tường VN (Node trên server chạy Asia/Ho_Chi_Minh):
-- now() và default của cột phải ra cùng giờ tường đó.
SET LOCAL TimeZone = 'Asia/Ho_Chi_Minh';

-- Thêm một ràng buộc nếu bảng đó chưa có ràng buộc trùng tên. Tra theo bảng
-- (conrelid) chứ không theo tên toàn cục: DB test có nhiều schema.
CREATE OR REPLACE FUNCTION pg_temp.career_add_constraint(tbl regclass, cname text, ddl text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = tbl AND conname = cname) THEN
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', tbl, cname, ddl);
  END IF;
END $$;

-- Đích của các khoá ngoại kép.
SELECT pg_temp.career_add_constraint('store_roles', 'ux_store_roles_store_id', 'UNIQUE (store_id, id)');
SELECT pg_temp.career_add_constraint('store_skills', 'ux_store_skills_store_id', 'UNIQUE (store_id, id)');
SELECT pg_temp.career_add_constraint('employee_profiles', 'ux_employee_profiles_store_id', 'UNIQUE (store_id, id)');

-- ---------------------------------------------------------------------------
-- 1. Bộ phận
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS store_departments (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  deleted_at timestamp NULL,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  parent_id uuid NULL,
  tier smallint NOT NULL,
  name varchar(80) NOT NULL,
  description varchar(200) NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_system boolean NOT NULL DEFAULT false
);
SELECT pg_temp.career_add_constraint('store_departments', 'ux_store_departments_store_id', 'UNIQUE (store_id, id)');
SELECT pg_temp.career_add_constraint('store_departments', 'ck_store_departments_tier', 'CHECK (tier BETWEEN 1 AND 4)');
-- Cấp 1 chỉ có bộ phận hệ thống, không có cha; mọi bộ phận khác có cha.
SELECT pg_temp.career_add_constraint('store_departments', 'ck_store_departments_system',
  'CHECK ((is_system AND tier = 1 AND parent_id IS NULL) OR (NOT is_system AND tier BETWEEN 2 AND 4 AND parent_id IS NOT NULL))');
-- Cha phải thuộc cùng cửa hàng. MATCH SIMPLE: parent_id null thì bỏ qua.
SELECT pg_temp.career_add_constraint('store_departments', 'fk_store_departments_parent',
  'FOREIGN KEY (store_id, parent_id) REFERENCES store_departments (store_id, id)');
CREATE INDEX IF NOT EXISTS ix_store_departments_store ON store_departments (store_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_store_departments_parent ON store_departments (parent_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_store_departments_name
  ON store_departments (store_id, lower(name)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_store_departments_system
  ON store_departments (store_id) WHERE is_system AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Vị trí (store_roles) và kỹ năng thuộc bộ phận, có thứ tự
-- ---------------------------------------------------------------------------
ALTER TABLE store_roles ADD COLUMN IF NOT EXISTS department_id uuid NULL;
ALTER TABLE store_roles ADD COLUMN IF NOT EXISTS rank integer NULL;

ALTER TABLE store_skills ADD COLUMN IF NOT EXISTS department_id uuid NULL;
ALTER TABLE store_skills ADD COLUMN IF NOT EXISTS sequence integer NULL;
ALTER TABLE store_skills ADD COLUMN IF NOT EXISTS level varchar(16) NOT NULL DEFAULT 'required';
ALTER TABLE store_skills ADD COLUMN IF NOT EXISTS confirmation varchar(16) NOT NULL DEFAULT 'manager';

SELECT pg_temp.career_add_constraint('store_roles', 'fk_store_roles_department',
  'FOREIGN KEY (store_id, department_id) REFERENCES store_departments (store_id, id)');
SELECT pg_temp.career_add_constraint('store_roles', 'ck_store_roles_rank', 'CHECK (rank IS NULL OR rank >= 1)');
-- Đổi thứ tự trong một transaction: SET CONSTRAINTS … DEFERRED. Vị trí bị xoá
-- mềm được đặt rank = null nên không chiếm chỗ.
SELECT pg_temp.career_add_constraint('store_roles', 'ux_store_roles_department_rank',
  'UNIQUE (department_id, rank) DEFERRABLE INITIALLY IMMEDIATE');

SELECT pg_temp.career_add_constraint('store_skills', 'fk_store_skills_department',
  'FOREIGN KEY (store_id, department_id) REFERENCES store_departments (store_id, id)');
SELECT pg_temp.career_add_constraint('store_skills', 'ck_store_skills_sequence', 'CHECK (sequence IS NULL OR sequence >= 1)');
SELECT pg_temp.career_add_constraint('store_skills', 'ck_store_skills_level', $c$CHECK (level IN ('required', 'optional'))$c$);
SELECT pg_temp.career_add_constraint('store_skills', 'ck_store_skills_confirmation', $c$CHECK (confirmation IN ('manager', 'auto'))$c$);
SELECT pg_temp.career_add_constraint('store_skills', 'ux_store_skills_department_sequence',
  'UNIQUE (department_id, sequence) DEFERRABLE INITIALLY IMMEDIATE');
CREATE INDEX IF NOT EXISTS ix_store_roles_department ON store_roles (department_id);
CREATE INDEX IF NOT EXISTS ix_store_skills_department ON store_skills (department_id);

-- ---------------------------------------------------------------------------
-- 3. Điều kiện vào một bộ phận / vị trí / kỹ năng
-- ---------------------------------------------------------------------------
-- Ba cột khoá ngoại thay cho subject_id đa hình: đúng một cột có giá trị.
CREATE TABLE IF NOT EXISTS career_requirements (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  deleted_at timestamp NULL,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  department_id uuid NULL,
  position_id uuid NULL,
  skill_id uuid NULL,
  code varchar(32) NOT NULL,
  operator varchar(4) NOT NULL DEFAULT 'gte',
  value numeric(12,2) NULL,
  ref_skill_id uuid NULL,
  is_required boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0
);
SELECT pg_temp.career_add_constraint('career_requirements', 'ck_career_requirements_subject',
  'CHECK (num_nonnulls(department_id, position_id, skill_id) = 1)');
SELECT pg_temp.career_add_constraint('career_requirements', 'ck_career_requirements_code', $c$CHECK (code IN (
    'monthly_shifts', 'monthly_hours',
    'work_hours', 'completed_shifts', 'skill_achieved', 'all_required_skills',
    'practice_hours', 'successful_reps', 'manager_review'))$c$);
SELECT pg_temp.career_add_constraint('career_requirements', 'ck_career_requirements_operator', $c$CHECK (operator IN ('gte', 'lte'))$c$);
SELECT pg_temp.career_add_constraint('career_requirements', 'ck_career_requirements_value', 'CHECK (value IS NULL OR value >= 0)');
SELECT pg_temp.career_add_constraint('career_requirements', 'ck_career_requirements_ref_skill',
  $c$CHECK ((code = 'skill_achieved') = (ref_skill_id IS NOT NULL))$c$);
SELECT pg_temp.career_add_constraint('career_requirements', 'fk_career_requirements_department',
  'FOREIGN KEY (store_id, department_id) REFERENCES store_departments (store_id, id) ON DELETE CASCADE');
SELECT pg_temp.career_add_constraint('career_requirements', 'fk_career_requirements_position',
  'FOREIGN KEY (store_id, position_id) REFERENCES store_roles (store_id, id) ON DELETE CASCADE');
SELECT pg_temp.career_add_constraint('career_requirements', 'fk_career_requirements_skill',
  'FOREIGN KEY (store_id, skill_id) REFERENCES store_skills (store_id, id) ON DELETE CASCADE');
SELECT pg_temp.career_add_constraint('career_requirements', 'fk_career_requirements_ref_skill',
  'FOREIGN KEY (store_id, ref_skill_id) REFERENCES store_skills (store_id, id)');
CREATE INDEX IF NOT EXISTS ix_career_requirements_department ON career_requirements (department_id) WHERE department_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_career_requirements_position ON career_requirements (position_id) WHERE position_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_career_requirements_skill ON career_requirements (skill_id) WHERE skill_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_career_requirements_ref_skill ON career_requirements (ref_skill_id) WHERE ref_skill_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Hồ sơ nhân viên thuộc một bộ phận
-- ---------------------------------------------------------------------------
ALTER TABLE employee_profiles ADD COLUMN IF NOT EXISTS department_id uuid NULL;
SELECT pg_temp.career_add_constraint('employee_profiles', 'fk_employee_profiles_department',
  'FOREIGN KEY (store_id, department_id) REFERENCES store_departments (store_id, id)');
CREATE INDEX IF NOT EXISTS ix_employee_profiles_department ON employee_profiles (department_id) WHERE department_id IS NOT NULL;
-- Vị trí của hồ sơ phải cùng cửa hàng. NOT VALID: chỉ chặn dữ liệu ghi từ nay,
-- không quét lại (và không làm hỏng migration nếu dữ liệu cũ có dòng lệch).
SELECT pg_temp.career_add_constraint('employee_profiles', 'fk_employee_profiles_store_role',
  'FOREIGN KEY (store_id, store_role_id) REFERENCES store_roles (store_id, id) NOT VALID');

-- ---------------------------------------------------------------------------
-- 5. Tiến độ và đánh giá kỹ năng
-- ---------------------------------------------------------------------------
-- Khoá / mở khoá tính theo quy tắc (career-evaluation.service.ts), không theo
-- việc có dòng hay không; dòng giữ mốc mở khoá và kết quả đạt. Khoá ngoại tới
-- kỹ năng KHÔNG xoá dây chuyền: lịch sử đạt kỹ năng phải còn (D10; kỹ năng chỉ
-- xoá mềm). Khoá ngoại tới hồ sơ thì xoá dây chuyền như mọi bảng con khác của
-- hồ sơ: "xoá vĩnh viễn nhân viên" xoá cả lịch sử của người đó.
CREATE TABLE IF NOT EXISTS employee_skill_progress (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  deleted_at timestamp NULL,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  employee_profile_id uuid NOT NULL,
  skill_id uuid NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'in_progress',
  unlocked_at timestamp NULL,
  achieved_at timestamp NULL,
  confirmed_by_account_id uuid NULL REFERENCES accounts(id) ON DELETE SET NULL,
  criteria_snapshot jsonb NULL,
  note varchar(500) NULL
);
SELECT pg_temp.career_add_constraint('employee_skill_progress', 'ck_employee_skill_progress_status',
  $c$CHECK (status IN ('in_progress', 'achieved'))$c$);
SELECT pg_temp.career_add_constraint('employee_skill_progress', 'fk_employee_skill_progress_profile',
  'FOREIGN KEY (store_id, employee_profile_id) REFERENCES employee_profiles (store_id, id) ON DELETE CASCADE');
SELECT pg_temp.career_add_constraint('employee_skill_progress', 'fk_employee_skill_progress_skill',
  'FOREIGN KEY (store_id, skill_id) REFERENCES store_skills (store_id, id)');
CREATE UNIQUE INDEX IF NOT EXISTS ux_employee_skill_progress_profile_skill
  ON employee_skill_progress (employee_profile_id, skill_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_employee_skill_progress_skill ON employee_skill_progress (skill_id);
CREATE INDEX IF NOT EXISTS ix_employee_skill_progress_store ON employee_skill_progress (store_id);

CREATE TABLE IF NOT EXISTS employee_skill_evaluations (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  deleted_at timestamp NULL,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  employee_profile_id uuid NOT NULL,
  skill_id uuid NOT NULL,
  result varchar(8) NOT NULL,
  evaluated_by_account_id uuid NULL REFERENCES accounts(id) ON DELETE SET NULL,
  evaluated_at timestamp NOT NULL DEFAULT now(),
  note varchar(500) NULL,
  client_request_id varchar(64) NULL
);
SELECT pg_temp.career_add_constraint('employee_skill_evaluations', 'ck_employee_skill_evaluations_result',
  $c$CHECK (result IN ('pass', 'fail'))$c$);
SELECT pg_temp.career_add_constraint('employee_skill_evaluations', 'fk_employee_skill_evaluations_profile',
  'FOREIGN KEY (store_id, employee_profile_id) REFERENCES employee_profiles (store_id, id) ON DELETE CASCADE');
SELECT pg_temp.career_add_constraint('employee_skill_evaluations', 'fk_employee_skill_evaluations_skill',
  'FOREIGN KEY (store_id, skill_id) REFERENCES store_skills (store_id, id)');
CREATE INDEX IF NOT EXISTS ix_employee_skill_evaluations_profile_skill
  ON employee_skill_evaluations (employee_profile_id, skill_id, evaluated_at);
-- Gửi lặp cùng một clientRequestId không ghi hai lần.
CREATE UNIQUE INDEX IF NOT EXISTS ux_employee_skill_evaluations_request
  ON employee_skill_evaluations (store_id, client_request_id) WHERE client_request_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. Lịch sử: sự kiện v2 không gắn với bậc lộ trình
-- ---------------------------------------------------------------------------
ALTER TABLE employee_career_events ADD COLUMN IF NOT EXISTS subject_type varchar(16) NULL;
ALTER TABLE employee_career_events ADD COLUMN IF NOT EXISTS from_target_id uuid NULL;
ALTER TABLE employee_career_events ADD COLUMN IF NOT EXISTS to_target_id uuid NULL;
ALTER TABLE employee_career_events ADD COLUMN IF NOT EXISTS client_request_id varchar(64) NULL;
ALTER TABLE employee_career_events ALTER COLUMN ladder_id DROP NOT NULL;
ALTER TABLE employee_career_events ALTER COLUMN to_rung_id DROP NOT NULL;
SELECT pg_temp.career_add_constraint('employee_career_events', 'ck_employee_career_events_subject',
  $c$CHECK (subject_type IS NULL OR subject_type IN ('department', 'position', 'skill'))$c$);
-- Mỗi sự kiện hoặc là sự kiện lộ trình cũ (ladder + bậc), hoặc là sự kiện v2.
SELECT pg_temp.career_add_constraint('employee_career_events', 'ck_employee_career_events_shape',
  'CHECK ((ladder_id IS NOT NULL AND to_rung_id IS NOT NULL) OR (subject_type IS NOT NULL AND to_target_id IS NOT NULL))');
CREATE INDEX IF NOT EXISTS ix_employee_career_events_subject
  ON employee_career_events (employee_profile_id, subject_type, effective_at) WHERE subject_type IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_employee_career_events_request
  ON employee_career_events (employee_profile_id, client_request_id) WHERE client_request_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 7. Cài đặt theo cửa hàng
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS store_career_settings (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  deleted_at timestamp NULL,
  store_id uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  review_reminder_enabled boolean NOT NULL DEFAULT false,
  review_frequency varchar(8) NOT NULL DEFAULT 'month',
  -- Khoá kỳ đã nhắc theo lịch VN ('2026-10-13', '2026-W42', '2026-10', '2026-Q4', '2026'):
  -- so khoá thay vì so mốc giờ nên không lệch múi giờ và không nhắc hai lần một kỳ.
  last_reminded_period varchar(16) NULL,
  v2_enabled boolean NOT NULL DEFAULT false
);
SELECT pg_temp.career_add_constraint('store_career_settings', 'ux_store_career_settings_store', 'UNIQUE (store_id)');
SELECT pg_temp.career_add_constraint('store_career_settings', 'ck_store_career_settings_frequency',
  $c$CHECK (review_frequency IN ('day', 'week', 'month', 'quarter', 'year'))$c$);

-- ---------------------------------------------------------------------------
-- 8. Chuyển dữ liệu — hàm dùng lại khi bật cờ cho từng cửa hàng
-- ---------------------------------------------------------------------------
-- p_store_id null = mọi cửa hàng. Chạy lại không tạo trùng, không xếp lại thứ
-- tự đã có; chỉ nhặt phần còn "mồ côi" (vị trí / kỹ năng / nhân viên chưa có
-- bộ phận, sự kiện lộ trình cũ chưa mang chủ thể v2).
CREATE OR REPLACE FUNCTION career_v2_backfill(p_store_id uuid)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  -- 8a. Dòng cài đặt và bộ phận Cấp 1 "Chủ cửa hàng".
  INSERT INTO store_career_settings (store_id)
  SELECT s.id FROM stores s
   WHERE (p_store_id IS NULL OR s.id = p_store_id)
     AND NOT EXISTS (SELECT 1 FROM store_career_settings c WHERE c.store_id = s.id);

  INSERT INTO store_departments (store_id, tier, name, description, sort_order, is_system)
  SELECT s.id, 1, 'Chủ cửa hàng', 'Quản lý toàn bộ hoạt động của cửa hàng', 0, true
    FROM stores s
   WHERE (p_store_id IS NULL OR s.id = p_store_id)
     AND NOT EXISTS (
       SELECT 1 FROM store_departments d
        WHERE d.store_id = s.id AND d.is_system AND d.deleted_at IS NULL
     );

  -- 8b. Còn vị trí / kỹ năng chưa có bộ phận → một bộ phận "Chung" (Cấp 3,
  -- dưới Cấp 1) để chứa chúng. Chủ đổi tên / tách bộ phận sau. Chỉ tạo khi
  -- thật sự còn thứ mồ côi, nên chủ đã đổi tên "Chung" thì chạy lại không đẻ
  -- thêm một "Chung" rỗng.
  INSERT INTO store_departments (store_id, parent_id, tier, name, description, sort_order, is_system)
  SELECT s.id, root.id, 3, 'Chung', 'Bộ phận mặc định khi chuyển sang lộ trình mới', 1, false
    FROM stores s
    JOIN store_departments root ON root.store_id = s.id AND root.is_system AND root.deleted_at IS NULL
   WHERE (p_store_id IS NULL OR s.id = p_store_id)
     AND (
           EXISTS (SELECT 1 FROM store_roles r WHERE r.store_id = s.id AND r.deleted_at IS NULL AND r.is_active AND r.department_id IS NULL)
        OR EXISTS (SELECT 1 FROM store_skills k WHERE k.store_id = s.id AND k.deleted_at IS NULL AND k.department_id IS NULL)
         )
     AND NOT EXISTS (
           SELECT 1 FROM store_departments d
            WHERE d.store_id = s.id AND lower(d.name) = 'chung' AND d.deleted_at IS NULL
         );

  -- 8c. Vị trí chưa có bộ phận → "Chung", theo bậc của lộ trình vị trí cũ (bậc
  -- thấp trước), vị trí không nằm trên lộ trình xếp sau theo ngày tạo. Nối
  -- tiếp sau rank lớn nhất đang có.
  WITH chung AS (
    SELECT d.store_id, d.id
      FROM store_departments d
     WHERE lower(d.name) = 'chung' AND NOT d.is_system AND d.deleted_at IS NULL
       AND (p_store_id IS NULL OR d.store_id = p_store_id)
  ),
  legacy_level AS (
    SELECT r.target_id AS role_id, min(r.level) AS level
      FROM store_ladder_rungs r
      JOIN store_ladders l ON l.id = r.ladder_id
     WHERE l.dimension = 'position' AND l.deleted_at IS NULL AND r.deleted_at IS NULL
     GROUP BY r.target_id
  ),
  todo AS (
    SELECT ro.id, ch.id AS department_id,
           row_number() OVER (
             PARTITION BY ch.id
             ORDER BY ll.level NULLS LAST, ro.created_at, ro.id
           ) AS n
      FROM store_roles ro
      JOIN chung ch ON ch.store_id = ro.store_id
      LEFT JOIN legacy_level ll ON ll.role_id = ro.id
     WHERE ro.department_id IS NULL AND ro.deleted_at IS NULL AND ro.is_active
  )
  UPDATE store_roles ro
     SET department_id = todo.department_id,
         rank = todo.n + COALESCE(
           (SELECT max(x.rank) FROM store_roles x WHERE x.department_id = todo.department_id), 0)
    FROM todo
   WHERE ro.id = todo.id;

  -- 8d. Kỹ năng chưa có bộ phận → "Chung", theo ngày tạo. Kỹ năng cũ là Tuỳ
  -- chọn: trước đây kỹ năng không chặn lên vị trí, chủ tự nâng lên Bắt buộc.
  WITH chung AS (
    SELECT d.store_id, d.id
      FROM store_departments d
     WHERE lower(d.name) = 'chung' AND NOT d.is_system AND d.deleted_at IS NULL
       AND (p_store_id IS NULL OR d.store_id = p_store_id)
  ),
  todo AS (
    SELECT k.id, ch.id AS department_id,
           row_number() OVER (PARTITION BY ch.id ORDER BY k.created_at, k.id) AS n
      FROM store_skills k
      JOIN chung ch ON ch.store_id = k.store_id
     WHERE k.department_id IS NULL AND k.deleted_at IS NULL
  )
  UPDATE store_skills k
     SET department_id = todo.department_id,
         sequence = todo.n + COALESCE(
           (SELECT max(x.sequence) FROM store_skills x WHERE x.department_id = todo.department_id), 0),
         level = 'optional'
    FROM todo
   WHERE k.id = todo.id;

  -- 8e. Nhân viên có vị trí thuộc bộ phận của vị trí đó.
  UPDATE employee_profiles p
     SET department_id = ro.department_id
    FROM store_roles ro
   WHERE ro.id = p.store_role_id
     AND ro.store_id = p.store_id
     AND ro.department_id IS NOT NULL
     AND p.department_id IS NULL
     AND (p_store_id IS NULL OR p.store_id = p_store_id);

  -- 8e2. Chưa có vị trí nhưng có kỹ năng: thuộc bộ phận của kỹ năng.
  UPDATE employee_profiles p
     SET department_id = k.department_id
    FROM store_skills k
   WHERE k.id = p.skill_id
     AND k.store_id = p.store_id
     AND k.department_id IS NOT NULL
     AND p.store_role_id IS NULL
     AND p.department_id IS NULL
     AND (p_store_id IS NULL OR p.store_id = p_store_id);

  -- 8f. Điều kiện của bậc vị trí cũ → điều kiện của vị trí. Prod chỉ có
  -- work_hours / completed_shifts (đối chiếu 2026-10-13); mã khác được liệt kê
  -- ở báo cáo cuối để chủ tự đặt lại, không đoán. Chỉ chép điều kiện bắt
  -- buộc: lộ trình cũ bỏ qua điều kiện tuỳ chọn khi xét, còn v2 xét mọi mục.
  INSERT INTO career_requirements (store_id, position_id, code, operator, value, is_required, sort_order)
  SELECT l.store_id, r.target_id, c.code, COALESCE(c.operator, 'gte'), c.value, true, c.sort_order
    FROM store_rung_criteria c
    JOIN store_ladder_rungs r ON r.id = c.rung_id AND r.deleted_at IS NULL
    JOIN store_ladders l ON l.id = r.ladder_id AND l.deleted_at IS NULL AND l.dimension = 'position'
    JOIN store_roles ro ON ro.id = r.target_id AND ro.store_id = l.store_id AND ro.deleted_at IS NULL
   WHERE c.deleted_at IS NULL
     AND c.kind = 'metric'
     AND c.is_required
     AND c.code IN ('work_hours', 'completed_shifts')
     AND (p_store_id IS NULL OR l.store_id = p_store_id)
     AND NOT EXISTS (
       SELECT 1 FROM career_requirements q
        WHERE q.position_id = r.target_id AND q.code = c.code AND q.deleted_at IS NULL
     );

  -- 8g. Kỹ năng đang gán trên hồ sơ → đã đạt kỹ năng đó (nhân viên đang làm).
  INSERT INTO employee_skill_progress (store_id, employee_profile_id, skill_id, status, unlocked_at, achieved_at, note)
  SELECT p.store_id, p.id, p.skill_id, 'achieved', NULL, now(), 'Chuyển từ kỹ năng gán trước lộ trình mới'
    FROM employee_profiles p
    JOIN store_skills k ON k.id = p.skill_id AND k.store_id = p.store_id AND k.deleted_at IS NULL
   WHERE p.deleted_at IS NULL
     AND (p_store_id IS NULL OR p.store_id = p_store_id)
     AND NOT EXISTS (
       SELECT 1 FROM employee_skill_progress g
        WHERE g.employee_profile_id = p.id AND g.skill_id = p.skill_id AND g.deleted_at IS NULL
     );

  -- 8h. Sự kiện lộ trình vị trí / kỹ năng cũ mang thêm chủ thể v2, để "từ lúc
  -- nhận vị trí" đọc một nguồn duy nhất. (Backend mới cũng ghi các cột này
  -- cho sự kiện lộ trình cũ, nên khoảng giữa migration và lúc bật cờ không
  -- để lại sự kiện thiếu chủ thể.)
  UPDATE employee_career_events e
     SET subject_type = CASE l.dimension WHEN 'position' THEN 'position' ELSE 'skill' END,
         to_target_id = tr.target_id,
         from_target_id = (SELECT fr.target_id FROM store_ladder_rungs fr WHERE fr.id = e.from_rung_id)
    FROM store_ladders l, store_ladder_rungs tr
   WHERE e.subject_type IS NULL
     AND l.id = e.ladder_id
     AND l.dimension IN ('position', 'skill')
     AND tr.id = e.to_rung_id
     AND (p_store_id IS NULL OR l.store_id = p_store_id);
END
$fn$;

SELECT career_v2_backfill(NULL);

COMMIT;

-- ---------------------------------------------------------------------------
-- Báo cáo sau khi chạy (chạy lại lần hai: mọi số phải giữ nguyên)
-- ---------------------------------------------------------------------------
SELECT 'after' AS phase,
       (SELECT count(*) FROM store_departments WHERE deleted_at IS NULL) AS departments,
       (SELECT count(*) FROM store_departments WHERE is_system AND deleted_at IS NULL) AS system_departments,
       (SELECT count(*) FROM store_roles WHERE deleted_at IS NULL AND is_active AND department_id IS NULL) AS positions_without_department,
       (SELECT count(*) FROM store_skills WHERE deleted_at IS NULL AND department_id IS NULL) AS skills_without_department,
       (SELECT count(*) FROM employee_profiles WHERE deleted_at IS NULL AND store_role_id IS NOT NULL AND department_id IS NULL) AS positioned_profiles_without_department,
       (SELECT count(*) FROM career_requirements WHERE deleted_at IS NULL) AS requirements,
       (SELECT count(*) FROM employee_skill_progress WHERE deleted_at IS NULL) AS skill_progress,
       (SELECT count(*) FROM employee_career_events WHERE subject_type IS NOT NULL) AS v2_events,
       (SELECT count(*) FROM store_career_settings) AS settings;

-- Điều kiện bậc vị trí cũ KHÔNG chuyển được (chủ cần đặt lại trên màn mới).
SELECT l.store_id, ro.name AS position, c.kind, c.code, c.operator, c.value, c.label
  FROM store_rung_criteria c
  JOIN store_ladder_rungs r ON r.id = c.rung_id AND r.deleted_at IS NULL
  JOIN store_ladders l ON l.id = r.ladder_id AND l.deleted_at IS NULL AND l.dimension = 'position'
  LEFT JOIN store_roles ro ON ro.id = r.target_id
 WHERE c.deleted_at IS NULL
   AND NOT (c.kind = 'metric' AND c.code IN ('work_hours', 'completed_shifts') AND c.is_required);

-- Điều kiện chéo lộ trình (kind = 'ladder') trỏ vào lộ trình vị trí / kỹ năng
-- cũ: sau khi bật v2 chúng đọc dữ liệu không còn được cập nhật.
SELECT l.store_id, l.dimension, c.label, target.dimension AS points_to
  FROM store_rung_criteria c
  JOIN store_ladder_rungs r ON r.id = c.rung_id AND r.deleted_at IS NULL
  JOIN store_ladders l ON l.id = r.ladder_id AND l.deleted_at IS NULL
  JOIN store_ladders target ON target.id::text = c.code
 WHERE c.deleted_at IS NULL
   AND c.kind = 'ladder'
   AND target.dimension IN ('position', 'skill');

-- Loại nhân viên không phải Thử việc / Chính thức (ví dụ "Bán Hàng"): chủ tự
-- chuyển thành vị trí trong bộ phận phù hợp.
SELECT t.store_id, t.name, count(p.id) AS profiles
  FROM store_employee_types t
  LEFT JOIN employee_profiles p ON p.employee_type_id = t.id AND p.deleted_at IS NULL
 WHERE t.deleted_at IS NULL
   AND lower(t.name) NOT IN ('thử việc', 'chính thức')
 GROUP BY t.store_id, t.name;
