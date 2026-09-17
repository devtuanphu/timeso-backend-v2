-- Lộ trình thăng tiến đa tác nhân.
--
-- Trước migration này, "lộ trình" được nhét vào chính bảng danh mục
-- store_employee_types qua cột level và bốn cột req_*, nên chỉ có đúng một
-- lộ trình cho mỗi cửa hàng và nó lẫn với loại nhân viên. Thử việc thì lại
-- nằm ở một cơ chế khác hẳn (store_probation_settings), chỉ có một con số
-- ngày và không có bậc nào.
--
-- Sau migration: mỗi "tác nhân" (dimension) có danh mục riêng đã tồn tại, và
-- lộ trình trở thành một cơ chế chung nâng nhân viên qua các bậc của tác nhân
-- đó. Bậc trỏ về danh mục bằng target_id; mã đọc dimension để biết ghi vào
-- trường nào trên employee_profiles.
--
--   dimension 'employment_type' -> store_employee_types -> employee_type_id
--   dimension 'position'        -> store_roles          -> store_role_id
--   dimension 'skill'           -> store_skills         -> skill_id
--
-- Chạy TRƯỚC khi build và restart. Không có TypeORM migration runner trong
-- repo này (DATABASE_SCHEMA_MODE=managed, synchronize=false), nên file này
-- được áp bằng tay qua psql.

BEGIN;

-- ---------------------------------------------------------------------------
-- Preflight
-- ---------------------------------------------------------------------------

-- Migration này bỏ cột và xoá bảng, nên nó chỉ chạy được đúng một lần. Chạy
-- lại sẽ hỏng ở bước tham chiếu cột đã bỏ và sinh ra một loạt lỗi khó đọc;
-- từ chối ngay bằng một thông báo duy nhất thì rõ hơn nhiều.
DO $$
BEGIN
  IF to_regclass('public.store_ladders') IS NOT NULL THEN
    RAISE EXCEPTION
      'Migration lộ trình đã được áp dụng trước đó (bảng store_ladders đã tồn tại). Không chạy lại.';
  END IF;
END $$;

-- Bảng employee_profile_roles bị xoá ở cuối file. Nó là quan hệ nhiều-nhiều
-- giữa hồ sơ và vị trí, nhưng một người chỉ giữ một vị trí tại một thời điểm,
-- và vị trí thật luôn được đọc từ employee_profiles.store_role_id. Bảng chỉ có
-- đường ghi (assignRoleToEmployee) và không có đường đọc nào. Nếu nó có dữ
-- liệu thì giả định đó sai và migration phải dừng lại.
--
-- Lồng hai IF chứ không dùng AND: PL/pgSQL lập kế hoạch cả biểu thức một lượt,
-- nên EXISTS trên bảng không tồn tại vẫn nổ dù vế trái đã sai.
DO $$
BEGIN
  IF to_regclass('public.employee_profile_roles') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM employee_profile_roles) THEN
      RAISE EXCEPTION
        'employee_profile_roles có dữ liệu — giả định "một người một vị trí" không còn đúng. Xem lại trước khi xoá bảng.';
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Bảng mới
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS store_ladders (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at  timestamp NOT NULL DEFAULT now(),
  updated_at  timestamp NOT NULL DEFAULT now(),
  deleted_at  timestamp NULL,
  store_id    uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  dimension   varchar(32) NOT NULL,
  name        varchar(255) NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  CONSTRAINT store_ladders_dimension_check
    CHECK (dimension IN ('employment_type', 'position', 'skill'))
);

-- Mỗi cửa hàng có tối đa một lộ trình cho mỗi tác nhân. Partial index để hàng
-- đã soft-delete không chặn việc tạo lại.
CREATE UNIQUE INDEX IF NOT EXISTS uq_store_ladders_store_dimension
  ON store_ladders (store_id, dimension)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS store_ladder_rungs (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at       timestamp NOT NULL DEFAULT now(),
  updated_at       timestamp NOT NULL DEFAULT now(),
  deleted_at       timestamp NULL,
  ladder_id        uuid NOT NULL REFERENCES store_ladders(id) ON DELETE CASCADE,
  level            int NOT NULL DEFAULT 0,
  -- Trỏ về một dòng trong danh mục của dimension thuộc ladder. Cố ý KHÔNG đặt
  -- khoá ngoại: bảng đích thay đổi theo dimension, nên ràng buộc được giữ ở
  -- tầng ứng dụng (CareerLadderService.assertTargetExists).
  target_id        uuid NOT NULL,
  approval         varchar(16) NOT NULL DEFAULT 'owner',
  suggested_salary numeric(12, 2) NULL,
  -- Vào bậc này thì đẩy lộ trình kia về bậc đầu. Dùng cho "thăng vị trí thì
  -- phải thử việc lại". Mặc định NULL = không đụng lộ trình nào khác.
  resets_ladder_id uuid NULL REFERENCES store_ladders(id) ON DELETE SET NULL,
  CONSTRAINT store_ladder_rungs_approval_check
    CHECK (approval IN ('auto', 'owner'))
);

-- Một giá trị danh mục chỉ xuất hiện một lần trên một lộ trình.
CREATE UNIQUE INDEX IF NOT EXISTS uq_store_ladder_rungs_ladder_target
  ON store_ladder_rungs (ladder_id, target_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_store_ladder_rungs_ladder_level
  ON store_ladder_rungs (ladder_id, level);

-- Cạnh của đồ thị lộ trình. from_rung_id NULL = điểm vào (nhân viên mới hoặc
-- người chưa ở bậc nào của lộ trình này có thể vào thẳng bậc đó). Lộ trình
-- được phép phân nhánh; không có chu trình — kiểm ở tầng ứng dụng khi lưu.
CREATE TABLE IF NOT EXISTS store_ladder_edges (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at   timestamp NOT NULL DEFAULT now(),
  updated_at   timestamp NOT NULL DEFAULT now(),
  deleted_at   timestamp NULL,
  ladder_id    uuid NOT NULL REFERENCES store_ladders(id) ON DELETE CASCADE,
  from_rung_id uuid NULL REFERENCES store_ladder_rungs(id) ON DELETE CASCADE,
  to_rung_id   uuid NOT NULL REFERENCES store_ladder_rungs(id) ON DELETE CASCADE
);

-- NULL không so sánh bằng nhau trong UNIQUE thường, nên điểm vào cần index
-- riêng để không tạo được hai cạnh vào cùng một bậc.
CREATE UNIQUE INDEX IF NOT EXISTS uq_store_ladder_edges_pair
  ON store_ladder_edges (ladder_id, from_rung_id, to_rung_id)
  WHERE deleted_at IS NULL AND from_rung_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_store_ladder_edges_entry
  ON store_ladder_edges (ladder_id, to_rung_id)
  WHERE deleted_at IS NULL AND from_rung_id IS NULL;

CREATE INDEX IF NOT EXISTS ix_store_ladder_edges_from
  ON store_ladder_edges (from_rung_id);

-- Điều kiện để VÀO một bậc. Chỉ số đo tự động, điều kiện thâm niên, mục
-- checklist chấm tay, và điều kiện chéo sang lộ trình khác đều nằm ở đây, chỉ
-- khác kind.
CREATE TABLE IF NOT EXISTS store_rung_criteria (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at  timestamp NOT NULL DEFAULT now(),
  updated_at  timestamp NOT NULL DEFAULT now(),
  deleted_at  timestamp NULL,
  rung_id     uuid NOT NULL REFERENCES store_ladder_rungs(id) ON DELETE CASCADE,
  kind        varchar(16) NOT NULL,
  -- Mã chỉ số với kind='metric'/'tenure'; với kind='ladder' là id của lộ trình
  -- được tham chiếu; NULL với kind='checklist'.
  code        varchar(64) NULL,
  operator    varchar(4) NULL,
  value       numeric(12, 2) NULL,
  label       text NOT NULL,
  unit        varchar(32) NULL,
  is_required boolean NOT NULL DEFAULT true,
  sort_order  int NOT NULL DEFAULT 0,
  CONSTRAINT store_rung_criteria_kind_check
    CHECK (kind IN ('metric', 'tenure', 'checklist', 'ladder')),
  CONSTRAINT store_rung_criteria_operator_check
    CHECK (operator IS NULL OR operator IN ('gte', 'lte'))
);

CREATE INDEX IF NOT EXISTS ix_store_rung_criteria_rung
  ON store_rung_criteria (rung_id, sort_order);

-- Lịch sử nghề nghiệp. Mọi bước lên bậc trên mọi lộ trình ghi vào đây; đây là
-- nguồn duy nhất trả lời "vào bậc hiện tại từ bao giờ", thứ mà điều kiện
-- days_in_rung cần.
CREATE TABLE IF NOT EXISTS employee_career_events (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at            timestamp NOT NULL DEFAULT now(),
  updated_at            timestamp NOT NULL DEFAULT now(),
  deleted_at            timestamp NULL,
  employee_profile_id   uuid NOT NULL REFERENCES employee_profiles(id) ON DELETE CASCADE,
  ladder_id             uuid NOT NULL REFERENCES store_ladders(id) ON DELETE CASCADE,
  from_rung_id          uuid NULL REFERENCES store_ladder_rungs(id) ON DELETE SET NULL,
  to_rung_id            uuid NOT NULL REFERENCES store_ladder_rungs(id) ON DELETE RESTRICT,
  effective_at          timestamp NOT NULL DEFAULT now(),
  decided_by_account_id uuid NULL REFERENCES accounts(id) ON DELETE SET NULL,
  -- Ảnh chụp điều kiện tại thời điểm duyệt. Không có nó thì khi chủ sửa điều
  -- kiện, lịch sử mất khả năng giải thích vì sao người đó được duyệt.
  criteria_snapshot     jsonb NULL,
  note                  text NULL
);

CREATE INDEX IF NOT EXISTS ix_employee_career_events_profile_time
  ON employee_career_events (employee_profile_id, ladder_id, effective_at DESC);

-- Điểm năng lực do chủ chấm. employee_profiles.capability_points là tổng được
-- duy trì khi ghi, giữ lại để điều kiện lọc không phải cộng dồn mỗi lần đánh giá.
CREATE TABLE IF NOT EXISTS employee_capability_entries (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at            timestamp NOT NULL DEFAULT now(),
  updated_at            timestamp NOT NULL DEFAULT now(),
  deleted_at            timestamp NULL,
  employee_profile_id   uuid NOT NULL REFERENCES employee_profiles(id) ON DELETE CASCADE,
  points                int NOT NULL,
  reason                text NULL,
  awarded_by_account_id uuid NULL REFERENCES accounts(id) ON DELETE SET NULL,
  awarded_at            timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_employee_capability_entries_profile
  ON employee_capability_entries (employee_profile_id, awarded_at DESC);

-- ---------------------------------------------------------------------------
-- 2. store_employee_types trở về là danh mục thuần
-- ---------------------------------------------------------------------------

-- Cờ này thay cho việc suy đoán từ tên. Bậc nào is_probation thì nhân viên vào
-- bậc đó mang employment_status = 'probation'.
ALTER TABLE store_employee_types
  ADD COLUMN IF NOT EXISTS is_probation boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- 3. Gieo lộ trình cho từng cửa hàng
-- ---------------------------------------------------------------------------

-- 3a. Lộ trình loại nhân viên: Thử việc -> Chính thức.
--     Hai danh mục này chưa tồn tại ở cửa hàng nào; tạo mới rồi dựng bậc.
INSERT INTO store_employee_types (store_id, code, name, is_probation, is_active)
SELECT s.id, 'PROBATION', 'Thử việc', true, true
FROM stores s
WHERE NOT EXISTS (
  SELECT 1 FROM store_employee_types t
  WHERE t.store_id = s.id AND t.code = 'PROBATION' AND t.deleted_at IS NULL
);

INSERT INTO store_employee_types (store_id, code, name, is_probation, is_active)
SELECT s.id, 'OFFICIAL', 'Chính thức', false, true
FROM stores s
WHERE NOT EXISTS (
  SELECT 1 FROM store_employee_types t
  WHERE t.store_id = s.id AND t.code = 'OFFICIAL' AND t.deleted_at IS NULL
);

INSERT INTO store_ladders (store_id, dimension, name)
SELECT s.id, 'employment_type', 'Lộ trình nhân sự'
FROM stores s
WHERE NOT EXISTS (
  SELECT 1 FROM store_ladders l
  WHERE l.store_id = s.id AND l.dimension = 'employment_type' AND l.deleted_at IS NULL
);

INSERT INTO store_ladder_rungs (ladder_id, level, target_id, approval)
SELECT l.id, 1, t.id, 'owner'
FROM store_ladders l
JOIN store_employee_types t
  ON t.store_id = l.store_id AND t.code = 'PROBATION' AND t.deleted_at IS NULL
WHERE l.dimension = 'employment_type' AND l.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM store_ladder_rungs r
    WHERE r.ladder_id = l.id AND r.target_id = t.id AND r.deleted_at IS NULL
  );

INSERT INTO store_ladder_rungs (ladder_id, level, target_id, approval)
SELECT l.id, 2, t.id, 'owner'
FROM store_ladders l
JOIN store_employee_types t
  ON t.store_id = l.store_id AND t.code = 'OFFICIAL' AND t.deleted_at IS NULL
WHERE l.dimension = 'employment_type' AND l.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM store_ladder_rungs r
    WHERE r.ladder_id = l.id AND r.target_id = t.id AND r.deleted_at IS NULL
  );

-- 3b. Lộ trình vị trí: các bậc lấy từ store_roles đang hoạt động, xếp theo tên
--     vì hiện chưa có thứ tự nào để giữ (mọi level cũ đều bằng 0). Chủ tự sắp
--     lại và tự thêm nhánh sau.
INSERT INTO store_ladders (store_id, dimension, name)
SELECT s.id, 'position', 'Lộ trình vị trí'
FROM stores s
WHERE EXISTS (
  SELECT 1 FROM store_roles r WHERE r.store_id = s.id AND r.deleted_at IS NULL
)
AND NOT EXISTS (
  SELECT 1 FROM store_ladders l
  WHERE l.store_id = s.id AND l.dimension = 'position' AND l.deleted_at IS NULL
);

INSERT INTO store_ladder_rungs (ladder_id, level, target_id, approval)
SELECT l.id, ranked.rn, ranked.id, 'owner'
FROM store_ladders l
JOIN (
  SELECT r.id, r.store_id,
         ROW_NUMBER() OVER (PARTITION BY r.store_id ORDER BY r.name) AS rn
  FROM store_roles r
  WHERE r.deleted_at IS NULL AND r.is_active = true
) ranked ON ranked.store_id = l.store_id
WHERE l.dimension = 'position' AND l.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM store_ladder_rungs rg
    WHERE rg.ladder_id = l.id AND rg.target_id = ranked.id AND rg.deleted_at IS NULL
  );

-- 3c. Cạnh: nối tuyến tính theo level trong từng lộ trình, và bậc thấp nhất
--     thành điểm vào. Phân nhánh là việc chủ tự thêm sau.
INSERT INTO store_ladder_edges (ladder_id, from_rung_id, to_rung_id)
SELECT r.ladder_id, NULL, r.id
FROM store_ladder_rungs r
WHERE r.deleted_at IS NULL
  AND r.level = (
    SELECT MIN(r2.level) FROM store_ladder_rungs r2
    WHERE r2.ladder_id = r.ladder_id AND r2.deleted_at IS NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM store_ladder_edges e
    WHERE e.ladder_id = r.ladder_id AND e.to_rung_id = r.id
      AND e.from_rung_id IS NULL AND e.deleted_at IS NULL
  );

INSERT INTO store_ladder_edges (ladder_id, from_rung_id, to_rung_id)
SELECT prev.ladder_id, prev.id, nxt.id
FROM store_ladder_rungs prev
JOIN LATERAL (
  SELECT r2.id
  FROM store_ladder_rungs r2
  WHERE r2.ladder_id = prev.ladder_id AND r2.deleted_at IS NULL
    AND r2.level > prev.level
  ORDER BY r2.level
  LIMIT 1
) nxt ON true
WHERE prev.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM store_ladder_edges e
    WHERE e.ladder_id = prev.ladder_id AND e.from_rung_id = prev.id
      AND e.to_rung_id = nxt.id AND e.deleted_at IS NULL
  );

-- ---------------------------------------------------------------------------
-- 4. Chuyển điều kiện cũ sang bậc
-- ---------------------------------------------------------------------------

-- 4a. Điều kiện thử việc: probation_days và probation_shifts của cửa hàng trở
--     thành điều kiện để vào bậc "Chính thức". Chỉ tạo khi giá trị > 0, để một
--     cửa hàng chưa cấu hình gì không sinh ra điều kiện rỗng luôn thoả.
INSERT INTO store_rung_criteria (rung_id, kind, code, operator, value, label, unit, is_required, sort_order)
SELECT r.id, 'tenure', 'days_in_rung', 'gte', ps.probation_days,
       'Đủ ' || ps.probation_days || ' ngày thử việc', 'ngày', true, 0
FROM store_ladders l
JOIN store_employee_types t
  ON t.store_id = l.store_id AND t.code = 'OFFICIAL' AND t.deleted_at IS NULL
JOIN store_ladder_rungs r
  ON r.ladder_id = l.id AND r.target_id = t.id AND r.deleted_at IS NULL
JOIN store_probation_settings ps
  ON ps.store_id = l.store_id AND ps.deleted_at IS NULL
WHERE l.dimension = 'employment_type' AND l.deleted_at IS NULL
  AND ps.probation_days > 0
  AND NOT EXISTS (
    SELECT 1 FROM store_rung_criteria c
    WHERE c.rung_id = r.id AND c.code = 'days_in_rung' AND c.deleted_at IS NULL
  );

INSERT INTO store_rung_criteria (rung_id, kind, code, operator, value, label, unit, is_required, sort_order)
SELECT r.id, 'metric', 'completed_shifts', 'gte', ps.probation_shifts,
       'Đủ ' || ps.probation_shifts || ' ca làm việc', 'ca', true, 1
FROM store_ladders l
JOIN store_employee_types t
  ON t.store_id = l.store_id AND t.code = 'OFFICIAL' AND t.deleted_at IS NULL
JOIN store_ladder_rungs r
  ON r.ladder_id = l.id AND r.target_id = t.id AND r.deleted_at IS NULL
JOIN store_probation_settings ps
  ON ps.store_id = l.store_id AND ps.deleted_at IS NULL
WHERE l.dimension = 'employment_type' AND l.deleted_at IS NULL
  AND ps.probation_shifts > 0
  AND NOT EXISTS (
    SELECT 1 FROM store_rung_criteria c
    WHERE c.rung_id = r.id AND c.code = 'completed_shifts' AND c.deleted_at IS NULL
  );

-- 4b. Hai checklist jsonb thành các dòng criteria kind='checklist'. Chữ
--     "[Bắt buộc]" đang được viết thẳng vào nhãn; tách nó ra thành cột
--     is_required thật rồi bỏ khỏi nhãn hiển thị. Mục hidden không được chuyển.
INSERT INTO store_rung_criteria (rung_id, kind, code, operator, value, label, unit, is_required, sort_order)
SELECT r.id,
       'checklist',
       NULL,
       NULL,
       NULLIF(item->>'targetValue', '')::numeric,
       btrim(replace(item->>'label', '[Bắt buộc]', '')),
       NULLIF(item->>'unit', ''),
       (item->>'label') LIKE '%[Bắt buộc]%',
       10 + ord::int
FROM store_ladders l
JOIN store_employee_types t
  ON t.store_id = l.store_id AND t.code = 'OFFICIAL' AND t.deleted_at IS NULL
JOIN store_ladder_rungs r
  ON r.ladder_id = l.id AND r.target_id = t.id AND r.deleted_at IS NULL
JOIN store_probation_settings ps
  ON ps.store_id = l.store_id AND ps.deleted_at IS NULL
CROSS JOIN LATERAL jsonb_array_elements(
  COALESCE(ps.attendance_checklist, '[]'::jsonb) || COALESCE(ps.attitude_checklist, '[]'::jsonb)
) WITH ORDINALITY AS arr(item, ord)
WHERE l.dimension = 'employment_type' AND l.deleted_at IS NULL
  AND COALESCE((item->>'hidden')::boolean, false) = false
  AND COALESCE(item->>'label', '') <> ''
  AND NOT EXISTS (
    SELECT 1 FROM store_rung_criteria c
    WHERE c.rung_id = r.id AND c.kind = 'checklist' AND c.deleted_at IS NULL
  );

-- 4c. Điều kiện thăng vị trí: bốn cột req_* cũ nằm trên danh mục loại nhân
--     viên, nhưng chúng mô tả điều kiện lên bậc. Chuyển sang bậc tương ứng của
--     lộ trình vị trí nếu tên khớp; nếu không khớp thì bỏ qua — trên production
--     mọi cột này đều bằng 0 nên không mất gì.
INSERT INTO store_rung_criteria (rung_id, kind, code, operator, value, label, unit, is_required, sort_order)
SELECT r.id, 'metric', 'on_time_percent', 'gte', t.req_on_time_percent,
       -- numeric(5,2) in ra "90.00"; cắt phần thập phân thừa cho nhãn hiển thị.
       trim(trailing '.' from trim(trailing '0' from t.req_on_time_percent::text)) || '% ca đúng giờ', '%', true, 0
FROM store_employee_types t
JOIN store_roles ro
  ON ro.store_id = t.store_id AND ro.name = t.name AND ro.deleted_at IS NULL
JOIN store_ladders l
  ON l.store_id = t.store_id AND l.dimension = 'position' AND l.deleted_at IS NULL
JOIN store_ladder_rungs r
  ON r.ladder_id = l.id AND r.target_id = ro.id AND r.deleted_at IS NULL
WHERE t.deleted_at IS NULL AND t.req_on_time_percent > 0
  AND NOT EXISTS (
    SELECT 1 FROM store_rung_criteria c
    WHERE c.rung_id = r.id AND c.code = 'on_time_percent' AND c.deleted_at IS NULL
  );

INSERT INTO store_rung_criteria (rung_id, kind, code, operator, value, label, unit, is_required, sort_order)
SELECT r.id, 'metric', 'unauthorized_leaves', 'lte', t.req_max_unauthorized_leave,
       'Nghỉ không phép tối đa ' || t.req_max_unauthorized_leave || ' ngày', 'ngày', true, 1
FROM store_employee_types t
JOIN store_roles ro
  ON ro.store_id = t.store_id AND ro.name = t.name AND ro.deleted_at IS NULL
JOIN store_ladders l
  ON l.store_id = t.store_id AND l.dimension = 'position' AND l.deleted_at IS NULL
JOIN store_ladder_rungs r
  ON r.ladder_id = l.id AND r.target_id = ro.id AND r.deleted_at IS NULL
WHERE t.deleted_at IS NULL AND t.req_max_unauthorized_leave > 0
  AND NOT EXISTS (
    SELECT 1 FROM store_rung_criteria c
    WHERE c.rung_id = r.id AND c.code = 'unauthorized_leaves' AND c.deleted_at IS NULL
  );

INSERT INTO store_rung_criteria (rung_id, kind, code, operator, value, label, unit, is_required, sort_order)
SELECT r.id, 'metric', 'capability_points', 'gte', t.req_min_capability_points,
       'Điểm năng lực tối thiểu ' || t.req_min_capability_points, 'điểm', true, 2
FROM store_employee_types t
JOIN store_roles ro
  ON ro.store_id = t.store_id AND ro.name = t.name AND ro.deleted_at IS NULL
JOIN store_ladders l
  ON l.store_id = t.store_id AND l.dimension = 'position' AND l.deleted_at IS NULL
JOIN store_ladder_rungs r
  ON r.ladder_id = l.id AND r.target_id = ro.id AND r.deleted_at IS NULL
WHERE t.deleted_at IS NULL AND t.req_min_capability_points > 0
  AND NOT EXISTS (
    SELECT 1 FROM store_rung_criteria c
    WHERE c.rung_id = r.id AND c.code = 'capability_points' AND c.deleted_at IS NULL
  );

-- ---------------------------------------------------------------------------
-- 5. Đưa hồ sơ hiện có vào lộ trình
-- ---------------------------------------------------------------------------

-- Ai đang làm việc thì gán loại nhân viên theo trạng thái thật: đang thử việc
-- thì vào bậc Thử việc, còn lại vào Chính thức. Người đã nghỉ giữ nguyên.
UPDATE employee_profiles p
SET employee_type_id = t.id
FROM store_employee_types t
WHERE t.store_id = p.store_id
  AND t.deleted_at IS NULL
  AND t.code = CASE WHEN p.employment_status = 'probation' THEN 'PROBATION' ELSE 'OFFICIAL' END
  AND p.deleted_at IS NULL
  AND p.employment_status IN ('active', 'probation', 'on_leave');

-- Một dòng lịch sử cho mỗi lộ trình mà hồ sơ đang đứng trên đó, lấy mốc
-- joined_at. Không có nó thì điều kiện days_in_rung không có gì để đếm từ.
INSERT INTO employee_career_events (employee_profile_id, ladder_id, from_rung_id, to_rung_id, effective_at, note)
SELECT p.id, l.id, NULL, r.id, COALESCE(p.joined_at, p.created_at),
       'Khởi tạo từ dữ liệu có sẵn khi áp dụng lộ trình'
FROM employee_profiles p
JOIN store_ladders l
  ON l.store_id = p.store_id AND l.dimension = 'employment_type' AND l.deleted_at IS NULL
JOIN store_ladder_rungs r
  ON r.ladder_id = l.id AND r.target_id = p.employee_type_id AND r.deleted_at IS NULL
WHERE p.deleted_at IS NULL
  AND p.employee_type_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM employee_career_events e
    WHERE e.employee_profile_id = p.id AND e.ladder_id = l.id AND e.deleted_at IS NULL
  );

INSERT INTO employee_career_events (employee_profile_id, ladder_id, from_rung_id, to_rung_id, effective_at, note)
SELECT p.id, l.id, NULL, r.id, COALESCE(p.joined_at, p.created_at),
       'Khởi tạo từ dữ liệu có sẵn khi áp dụng lộ trình'
FROM employee_profiles p
JOIN store_ladders l
  ON l.store_id = p.store_id AND l.dimension = 'position' AND l.deleted_at IS NULL
JOIN store_ladder_rungs r
  ON r.ladder_id = l.id AND r.target_id = p.store_role_id AND r.deleted_at IS NULL
WHERE p.deleted_at IS NULL
  AND p.store_role_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM employee_career_events e
    WHERE e.employee_profile_id = p.id AND e.ladder_id = l.id AND e.deleted_at IS NULL
  );

-- ---------------------------------------------------------------------------
-- 6. Dọn trùng lặp
-- ---------------------------------------------------------------------------

-- Cùng một khái niệm được nhập hai lần vào hai bảng vì hai màn hình khác nhau
-- đều đòi: "Thực tập" ở Nhoy Tea tồn tại vừa là vị trí vừa là loại nhân viên.
-- Vị trí là chỗ đúng của nó. Chỉ xoá hàng loại nhân viên nào đã bị tắt VÀ có
-- một vị trí trùng tên trong cùng cửa hàng — đủ hẹp để không đụng dữ liệu thật.
-- Bước 5 đã chuyển mọi hồ sơ sang bậc mới nên không còn ai tham chiếu.
UPDATE store_employee_types t
SET deleted_at = now()
WHERE t.deleted_at IS NULL
  AND t.is_active = false
  AND t.code IS DISTINCT FROM 'PROBATION'
  AND t.code IS DISTINCT FROM 'OFFICIAL'
  AND EXISTS (
    SELECT 1 FROM store_roles ro
    WHERE ro.store_id = t.store_id AND ro.name = t.name AND ro.deleted_at IS NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM employee_profiles p
    WHERE p.employee_type_id = t.id AND p.deleted_at IS NULL
  );

-- Loại nhân viên cũ còn lại (ví dụ "Full-time") không thuộc lộ trình nhân sự
-- mới. Tắt đi thay vì xoá: chúng có thể còn được tham chiếu từ hồ sơ đã nghỉ,
-- và chủ có thể muốn dựng lại thành bậc riêng.
UPDATE store_employee_types t
SET is_active = false
WHERE t.deleted_at IS NULL
  AND t.is_active = true
  AND t.code IS DISTINCT FROM 'PROBATION'
  AND t.code IS DISTINCT FROM 'OFFICIAL';

-- ---------------------------------------------------------------------------
-- 7. Bỏ các cột và bảng đã hết vai trò
-- ---------------------------------------------------------------------------

-- Lưu ý: skillName là cột camelCase có nháy kép trong Postgres, không phải
-- skill_name — entity khai @Column({ nullable: true }) mà không đặt name, nên
-- TypeORM giữ nguyên tên thuộc tính.
ALTER TABLE store_employee_types
  DROP COLUMN IF EXISTS level,
  DROP COLUMN IF EXISTS "skillName",
  DROP COLUMN IF EXISTS req_on_time_percent,
  DROP COLUMN IF EXISTS req_max_unauthorized_leave,
  DROP COLUMN IF EXISTS req_min_capability_points,
  DROP COLUMN IF EXISTS req_no_complaints;

ALTER TABLE store_probation_settings
  DROP COLUMN IF EXISTS probation_days,
  DROP COLUMN IF EXISTS probation_shifts,
  DROP COLUMN IF EXISTS attendance_checklist,
  DROP COLUMN IF EXISTS attitude_checklist;

DROP TABLE IF EXISTS employee_profile_roles;

COMMIT;
