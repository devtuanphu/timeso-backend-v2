-- Điền EMAIL / ĐỊA CHỈ cho tài khoản của nhân viên HIỆN TẠI từ đơn ứng tuyển
-- đã nhận, cho những hồ sơ được tuyển TRƯỚC khi backend ghi thông tin lúc nhận
-- (JobApplicationService.recordApplicantDetails, commit e2e10a1). Những nhân
-- viên này không có email/địa chỉ trên tài khoản, nhưng đơn ứng tuyển đã nhận
-- vẫn còn giữ giá trị họ tự nhập (cho tới khi bị xoá liên hệ sau 90 ngày).
--
-- CHỈ ĐIỀN Ô TRỐNG, không bao giờ ghi đè giá trị nhân viên đã tự nhập
-- (quyết định 1a/1b):
--   - địa chỉ: điền khi accounts.address rỗng/blank và đơn có địa chỉ (đã trim).
--   - email:  điền khi accounts.email rỗng/blank, đơn có email, KHÔNG tài khoản
--             nào khác đang dùng email đó (so sánh không phân biệt hoa thường —
--             cột accounts.email là UNIQUE), và trong lần chạy này không có hai
--             tài khoản đích cùng muốn một email (nếu có thì BỎ QUA cả hai để
--             không vi phạm ràng buộc). Email lưu theo đúng chuẩn hoá của
--             setEmailIfEmpty (normalizeEmail = trim + lower).
--
-- Phạm vi nguồn: đơn ACCEPTED còn dữ liệu (deleted_at IS NULL, contact_redacted_at
-- IS NULL) của một nhân viên đang làm (employee_profiles.deleted_at IS NULL)
-- theo đúng (account_id, store_id). Với mỗi tài khoản, lấy giá trị không rỗng ở
-- đơn được nhận GẦN NHẤT.
--
-- KHÔNG chạy bằng scripts/migrate.sh (đây là script dữ liệu, chạy lại được).
-- Bản xem trước và báo cáo CHỈ in SỐ LƯỢNG — không in email/địa chỉ, không in id.
--
--   Xem trước (mặc định, không ghi gì):
--     psql -f scripts/backfill_employee_contact_from_application.sql
--   Ghi:
--     psql -v apply=1 -f scripts/backfill_employee_contact_from_application.sql
--
-- `apply` là giá trị đúng/sai của psql: chỉ 1/true/on/yes mới ghi; 0/false/off/no
-- hoặc không truyền = xem trước (ROLLBACK). Chạy lại sau khi đã ghi: 0 thay đổi.
--
-- Thứ tự triển khai: deploy backend (recordApplicantDetails + fallback đọc) rồi
-- chạy script này một lần. Fallback đọc ở getEmployeeById đã hiển thị đúng dù
-- chưa chạy script; script dọn dữ liệu để các màn hình khác (đọc thẳng account)
-- cũng đúng.

\set ON_ERROR_STOP on

\if :{?apply}
\else
  \set apply false
\endif
\if :apply
  \echo '== CHẾ ĐỘ: GHI (apply) — các thay đổi dưới đây sẽ được COMMIT'
\else
  \echo '== CHẾ ĐỘ: XEM TRƯỚC — không ghi gì (ROLLBACK)'
\endif

BEGIN;

-- Đơn ACCEPTED còn dữ liệu của nhân viên đang làm, theo đúng (account_id, store_id).
CREATE TEMP TABLE bf_candidates ON COMMIT DROP AS
SELECT app.account_id,
       app.reviewed_at,
       app.id AS application_id,
       NULLIF(btrim(app.address), '') AS address,
       lower(NULLIF(btrim(app.email), '')) AS email
  FROM store_job_applications app
  JOIN employee_profiles p
    ON p.account_id = app.account_id
   AND p.store_id = app.store_id
   AND p.deleted_at IS NULL
 WHERE app.status = 'ACCEPTED'
   AND app.deleted_at IS NULL
   AND app.contact_redacted_at IS NULL;

-- Với mỗi tài khoản: địa chỉ / email không rỗng ở đơn được nhận gần nhất.
CREATE TEMP TABLE bf_account_source ON COMMIT DROP AS
SELECT account_id,
       (array_agg(address ORDER BY reviewed_at DESC NULLS LAST, application_id DESC)
          FILTER (WHERE address IS NOT NULL))[1] AS address,
       (array_agg(email ORDER BY reviewed_at DESC NULLS LAST, application_id DESC)
          FILTER (WHERE email IS NOT NULL))[1] AS email
  FROM bf_candidates
 GROUP BY account_id;

-- Kế hoạch địa chỉ: chỉ điền khi tài khoản còn trống và đơn có địa chỉ.
CREATE TEMP TABLE bf_address_plan ON COMMIT DROP AS
SELECT s.account_id, s.address AS new_address
  FROM bf_account_source s
  JOIN accounts a ON a.id = s.account_id
 WHERE s.address IS NOT NULL
   AND NULLIF(btrim(a.address), '') IS NULL;

-- Email mà một tài khoản ĐỦ điều kiện nhận: tài khoản đang trống email, đơn có
-- email, và chưa tài khoản nào khác dùng email đó (không phân biệt hoa thường).
CREATE TEMP TABLE bf_email_wanted ON COMMIT DROP AS
SELECT s.account_id, s.email
  FROM bf_account_source s
  JOIN accounts a ON a.id = s.account_id
 WHERE s.email IS NOT NULL
   AND NULLIF(btrim(a.email), '') IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM accounts other
      WHERE other.id <> s.account_id
        AND lower(btrim(other.email)) = s.email
   );

-- Kế hoạch email: bỏ email mà có từ HAI tài khoản đích trở lên cùng muốn (nếu
-- ghi cả hai sẽ vi phạm UNIQUE) — bỏ cả hai cho an toàn và tất định.
CREATE TEMP TABLE bf_email_plan ON COMMIT DROP AS
SELECT w.account_id, w.email AS new_email
  FROM bf_email_wanted w
 WHERE (SELECT count(*) FROM bf_email_wanted w2 WHERE w2.email = w.email) = 1;

\echo '== Tóm tắt (số lượng)'
SELECT (SELECT count(*) FROM bf_candidates) AS candidate_applications,
       (SELECT count(*) FROM bf_account_source) AS accounts_with_candidate,
       (SELECT count(*) FROM bf_address_plan) AS will_set_address,
       (SELECT count(*) FROM bf_email_plan) AS will_set_email,
       (SELECT count(*) FROM bf_email_wanted) AS email_targets_before_dedup,
       ((SELECT count(*) FROM bf_email_wanted)
          - (SELECT count(*) FROM bf_email_plan)) AS email_skipped_as_duplicate;

\if :apply
UPDATE accounts a
   SET address = p.new_address
  FROM bf_address_plan p
 WHERE a.id = p.account_id;

UPDATE accounts a
   SET email = p.new_email
  FROM bf_email_plan p
 WHERE a.id = p.account_id;

COMMIT;
\echo '== Đã ghi.'
\else
ROLLBACK;
\echo '== Xem trước: chưa ghi gì. Thêm -v apply=1 để ghi.'
\endif
