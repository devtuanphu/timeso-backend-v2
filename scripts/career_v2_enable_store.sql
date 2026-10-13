-- Bật lộ trình thăng tiến v2 cho MỘT cửa hàng (SaaS-7, bật dần).
--
-- Chạy sau scripts/migration_career_v2.sql và sau khi backend mới đã chạy.
-- Trong cùng một transaction: khoá dòng cài đặt của cửa hàng (mọi thao tác ghi
-- lộ trình v2 cũng khoá dòng này), chuyển nốt phần dữ liệu phát sinh kể từ lúc
-- chạy migration (vị trí / kỹ năng / nhân viên tạo bằng app cũ), rồi bật cờ.
--
-- Chạy: psql ... -v ON_ERROR_STOP=1 -v store_id=<uuid> -f scripts/career_v2_enable_store.sql
--
-- Tắt lại (UPDATE … SET v2_enabled = false) không phải hoàn tác sạch: sự
-- kiện, tiến độ kỹ năng và bộ phận ghi theo v2 không hiện trên màn cũ.

\set ON_ERROR_STOP on

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL TimeZone = 'Asia/Ho_Chi_Minh';

SELECT career_v2_backfill(:'store_id'::uuid);

SELECT id FROM store_career_settings WHERE store_id = :'store_id'::uuid FOR UPDATE;
-- Chạy lại sau khi đã khoá: mọi thao tác ghi v2 đã phải chờ khoá này. Các
-- route ghi kiểu cũ (app cũ tạo vị trí / kỹ năng) đọc cờ không khoá, nên một
-- vị trí tạo đúng khoảnh khắc bật cờ vẫn có thể chưa có bộ phận: nó hiện ở
-- nhóm "Chưa phân bộ phận" và chạy lại script này là nhặt nốt.
SELECT career_v2_backfill(:'store_id'::uuid);

UPDATE store_career_settings
   SET v2_enabled = true, updated_at = now()
 WHERE store_id = :'store_id'::uuid;

COMMIT;

SELECT s.name, c.v2_enabled,
       (SELECT count(*) FROM store_departments d WHERE d.store_id = s.id AND d.deleted_at IS NULL) AS departments,
       (SELECT count(*) FROM store_roles r WHERE r.store_id = s.id AND r.deleted_at IS NULL AND r.department_id IS NULL) AS positions_without_department,
       (SELECT count(*) FROM employee_profiles p WHERE p.store_id = s.id AND p.deleted_at IS NULL AND p.store_role_id IS NOT NULL AND p.department_id IS NULL) AS positioned_profiles_without_department
  FROM stores s JOIN store_career_settings c ON c.store_id = s.id
 WHERE s.id = :'store_id'::uuid;
