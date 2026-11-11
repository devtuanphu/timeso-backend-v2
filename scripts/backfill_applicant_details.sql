-- Bổ sung thông tin từ đơn ứng tuyển cho nhân viên được nhận TRƯỚC khi backend
-- ghi thông tin lúc nhận (JobApplicationService.recordApplicantDetails), cùng
-- quy tắc:
--  - tài khoản: giới tính, ngày sinh, địa chỉ.
--    · Ô đang trống: điền giá trị gần nhất (không rỗng) trong các đơn thuộc
--      phạm vi của tài khoản.
--    · Ô đã có giá trị khác: chỉ ghi đè bằng ĐƠN ĐƯỢC NHẬN GẦN NHẤT của tài
--      khoản (xét mọi đơn đã nhận, kể cả đơn nhận sau `before` hay ở hồ sơ đã
--      nghỉ — đơn đó ngoài phạm vi thì đã có quyết định mới hơn, bỏ qua), và chỉ
--      khi tài khoản chưa đổi gì sau lúc nhận (updated_at <= reviewed_at + 10
--      phút) — sau đó có thể chính nhân viên / chủ đã sửa, nên giữ nguyên.
--    · Giới tính so theo nghĩa: 'Nam' = 'male', 'Nữ' = 'female', 'Khác' =
--      'other' (form của chủ ghi bộ tiếng Anh) — giá trị tương đương không đổi.
--    · Giá trị rỗng trong đơn không xoá gì.
--  - email: chỉ khi tài khoản chưa có email, không tài khoản nào khác dùng, và
--    không trùng giữa các tài khoản trong lần chạy (email là tên đăng nhập,
--    unique); lấy email gần nhất trong các đơn thuộc phạm vi.
--  - hồ sơ nhân viên ở cửa hàng: giới thiệu bản thân của đơn được nhận gần nhất
--    của chính hồ sơ đó (chỉ khi đơn đó thuộc phạm vi và có nội dung).
-- Phạm vi: đơn ACCEPTED còn dữ liệu (chưa bị xoá theo hạn 90 ngày), nhận trước
-- mốc `before`, của hồ sơ đang làm việc thuộc đợt làm hiện tại.
--
-- KHÔNG chạy bằng scripts/migrate.sh (đây là script dữ liệu, chạy lại được).
-- Bản xem trước chỉ in id và cờ có / không — không in thông tin cá nhân.
--
--   Xem trước (mặc định, không ghi gì):
--     psql -v before='2026-11-11 08:00:00+07' -f scripts/backfill_applicant_details.sql
--   Ghi:
--     psql -v before='2026-11-11 08:00:00+07' -v apply=1 -f scripts/backfill_applicant_details.sql
--
-- `apply` là giá trị đúng / sai của psql: chỉ 1 / true / on / yes mới ghi;
-- 0 / false / off / no hoặc không truyền = xem trước. Giá trị lạ (vd apply=
-- hay apply=maybe): psql báo "Boolean expected" và coi là sai — chỉ xem
-- trước, không ghi gì.
--
-- `before` = lúc deploy backend có recordApplicantDetails: đơn nhận sau mốc này
-- đã được ghi lúc nhận.

\set ON_ERROR_STOP on

\if :{?before}
\else
  \echo 'Thiếu -v before=<thời điểm deploy backend ghi thông tin lúc nhận>'
  \quit
\endif

\if :{?apply}
\else
  \set apply false
\endif
\if :apply
  \echo '== CHẾ ĐỘ: GHI (apply) — các thay đổi dưới đây sẽ được COMMIT'
\else
  \echo '== CHẾ ĐỘ: XEM TRƯỚC — không ghi gì (ROLLBACK)'
\endif

-- accounts.updated_at do PostgreSQL ghi (CURRENT_TIMESTAMP, cột không múi
-- giờ) theo múi giờ phiên của backend; employee_profiles.joined_at do backend
-- ghi (new Date()) theo giờ máy chủ. Trên prod cả hai là Asia/Ho_Chi_Minh, và
-- phiên psql này (cùng máy chủ, cùng vai trò) mặc định cũng vậy. Phép so với
-- reviewed_at bên dưới chỉ đúng khi múi giờ đó là +07: khác thì dừng, không đoán.
SELECT current_setting('TimeZone') AS session_time_zone,
       extract(timezone FROM now()) = 7 * 3600 AS session_is_utc7
\gset
\echo '== Múi giờ mặc định của phiên:' :session_time_zone
\if :session_is_utc7
\else
  \echo 'Múi giờ mặc định của phiên không phải +07 như lúc backend ghi updated_at / joined_at. Dừng, không ghi gì.'
  \quit
\endif

BEGIN;
SET LOCAL TimeZone = 'Asia/Ho_Chi_Minh';

-- Giới tính theo nghĩa, như genderMeaning trong job-application.service.ts.
CREATE OR REPLACE FUNCTION pg_temp.n16_gender(value text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(btrim(value))
           WHEN '' THEN NULL
           WHEN 'nam' THEN 'male'
           WHEN 'male' THEN 'male'
           WHEN 'nữ' THEN 'female'
           WHEN 'female' THEN 'female'
           WHEN 'khác' THEN 'other'
           WHEN 'other' THEN 'other'
           ELSE lower(btrim(value))
         END
$$;

CREATE TEMP TABLE n16_candidates ON COMMIT DROP AS
SELECT app.id AS application_id,
       app.account_id,
       app.employee_profile_id AS profile_id,
       app.reviewed_at,
       NULLIF(btrim(app.gender), '') AS gender,
       app.birthday,
       NULLIF(btrim(app.address), '') AS address,
       lower(NULLIF(btrim(app.email), '')) AS email,
       NULLIF(btrim(app.introduction), '') AS introduction
  FROM store_job_applications app
  JOIN employee_profiles p ON p.id = app.employee_profile_id
 WHERE app.status = 'ACCEPTED'
   AND app.deleted_at IS NULL
   AND app.contact_redacted_at IS NULL
   AND app.reviewed_at IS NOT NULL
   AND app.reviewed_at >= now() - interval '90 days'
   AND app.reviewed_at < :'before'::timestamptz
   AND p.deleted_at IS NULL
   AND p.store_id = app.store_id
   AND p.account_id = app.account_id
   AND p.employment_status IN ('active', 'probation', 'on_leave')
   -- Đợt làm hiện tại: tuyển lại sau lần nhận này thì đơn đã cũ.
   AND (p.joined_at IS NULL OR app.reviewed_at >= p.joined_at - interval '60 seconds');

-- Đơn được nhận gần nhất của mỗi tài khoản trong 90 ngày, xét MỌI đơn ACCEPTED
-- (cả đơn nhận sau `before`, ở hồ sơ đã nghỉ, đã xoá dữ liệu): nếu nó không
-- thuộc phạm vi thì đã có thông tin mới hơn — không ghi đè bằng đơn cũ.
CREATE TEMP TABLE n16_latest_accepted ON COMMIT DROP AS
SELECT DISTINCT ON (app.account_id) app.account_id, app.id AS application_id
  FROM store_job_applications app
 WHERE app.status = 'ACCEPTED'
   AND app.reviewed_at IS NOT NULL
   AND app.reviewed_at >= now() - interval '90 days'
 ORDER BY app.account_id, app.reviewed_at DESC, app.id DESC;

-- Nguồn ghi đè: đơn được nhận gần nhất của tài khoản, khi nó thuộc phạm vi.
CREATE TEMP TABLE n16_account_source ON COMMIT DROP AS
SELECT c.*
  FROM n16_candidates c
  JOIN n16_latest_accepted l ON l.application_id = c.application_id;

-- Nguồn điền ô trống: giá trị gần nhất (không rỗng) trong các đơn thuộc phạm vi.
CREATE TEMP TABLE n16_account_fill ON COMMIT DROP AS
SELECT account_id,
       (array_agg(gender ORDER BY reviewed_at DESC, application_id DESC)
          FILTER (WHERE gender IS NOT NULL))[1] AS gender,
       (array_agg(birthday ORDER BY reviewed_at DESC, application_id DESC)
          FILTER (WHERE birthday IS NOT NULL))[1] AS birthday,
       (array_agg(address ORDER BY reviewed_at DESC, application_id DESC)
          FILTER (WHERE address IS NOT NULL))[1] AS address,
       (array_agg(email ORDER BY reviewed_at DESC, application_id DESC)
          FILTER (WHERE email IS NOT NULL))[1] AS email
  FROM n16_candidates
 GROUP BY account_id;

CREATE TEMP TABLE n16_account_plan ON COMMIT DROP AS
SELECT f.account_id,
       s.application_id AS overwrite_application_id,
       (s.application_id IS NOT NULL
        AND a.updated_at <= s.reviewed_at + interval '10 minutes') AS may_overwrite,
       CASE
         WHEN pg_temp.n16_gender(a.gender) IS NULL THEN f.gender
         WHEN s.gender IS NOT NULL
              AND a.updated_at <= s.reviewed_at + interval '10 minutes'
              AND pg_temp.n16_gender(a.gender) IS DISTINCT FROM pg_temp.n16_gender(s.gender)
         THEN s.gender
       END AS new_gender,
       CASE
         WHEN a.birthday IS NULL THEN f.birthday
         WHEN s.birthday IS NOT NULL
              AND a.updated_at <= s.reviewed_at + interval '10 minutes'
              AND a.birthday IS DISTINCT FROM s.birthday
         THEN s.birthday
       END AS new_birthday,
       CASE
         WHEN NULLIF(btrim(a.address), '') IS NULL THEN f.address
         WHEN s.address IS NOT NULL
              AND a.updated_at <= s.reviewed_at + interval '10 minutes'
              AND a.address IS DISTINCT FROM s.address
         THEN s.address
       END AS new_address,
       CASE
         WHEN f.email IS NOT NULL
              AND NULLIF(btrim(a.email), '') IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM accounts other
                 WHERE other.id <> f.account_id AND lower(other.email) = f.email
              )
              AND (SELECT count(DISTINCT x.account_id)
                     FROM n16_account_fill x
                    WHERE x.email = f.email) = 1
         THEN f.email
       END AS new_email,
       -- Đơn gần nhất có giá trị khác nhưng không ghi đè vì tài khoản đã đổi
       -- sau lúc nhận.
       (s.application_id IS NOT NULL
        AND a.updated_at > s.reviewed_at + interval '10 minutes' AND (
          (s.gender IS NOT NULL AND pg_temp.n16_gender(a.gender) IS NOT NULL
           AND pg_temp.n16_gender(a.gender) IS DISTINCT FROM pg_temp.n16_gender(s.gender))
          OR (s.birthday IS NOT NULL AND a.birthday IS NOT NULL AND a.birthday IS DISTINCT FROM s.birthday)
          OR (s.address IS NOT NULL AND NULLIF(btrim(a.address), '') IS NOT NULL AND a.address IS DISTINCT FROM s.address)
       )) AS kept_newer_account_values,
       -- Đơn được nhận gần nhất của tài khoản không thuộc phạm vi: chỉ điền ô trống.
       (s.application_id IS NULL) AS superseded_by_newer_application
  FROM n16_account_fill f
  JOIN accounts a ON a.id = f.account_id
  LEFT JOIN n16_account_source s ON s.account_id = f.account_id;

-- Giới thiệu: theo đơn được nhận gần nhất của chính hồ sơ, khi đơn đó thuộc phạm vi.
CREATE TEMP TABLE n16_profile_plan ON COMMIT DROP AS
SELECT c.profile_id, c.application_id, c.introduction AS new_introduction
  FROM n16_candidates c
  JOIN (
    SELECT DISTINCT ON (employee_profile_id) employee_profile_id, id
      FROM store_job_applications
     WHERE status = 'ACCEPTED'
       AND employee_profile_id IS NOT NULL
       AND reviewed_at IS NOT NULL
       AND reviewed_at >= now() - interval '90 days'
     ORDER BY employee_profile_id, reviewed_at DESC, id DESC
  ) latest ON latest.id = c.application_id
  JOIN employee_profiles p ON p.id = c.profile_id
 WHERE c.introduction IS NOT NULL
   AND p.introduction IS DISTINCT FROM c.introduction;

\echo '== Tóm tắt (số dòng)'
SELECT (SELECT count(*) FROM n16_candidates) AS accepted_applications_in_scope,
       (SELECT count(*) FROM n16_account_plan WHERE new_gender IS NOT NULL) AS set_gender,
       (SELECT count(*) FROM n16_account_plan WHERE new_birthday IS NOT NULL) AS set_birthday,
       (SELECT count(*) FROM n16_account_plan WHERE new_address IS NOT NULL) AS set_address,
       (SELECT count(*) FROM n16_account_plan WHERE new_email IS NOT NULL) AS set_email,
       (SELECT count(*) FROM n16_profile_plan) AS set_introduction,
       (SELECT count(*) FROM n16_account_plan WHERE kept_newer_account_values) AS kept_newer_account_values,
       (SELECT count(*) FROM n16_account_plan WHERE superseded_by_newer_application) AS superseded_by_newer_application;

\echo '== Tài khoản sẽ đổi (chỉ id và cờ, không có giá trị)'
SELECT account_id,
       overwrite_application_id,
       new_gender IS NOT NULL AS gender,
       new_birthday IS NOT NULL AS birthday,
       new_address IS NOT NULL AS address,
       new_email IS NOT NULL AS email,
       may_overwrite,
       superseded_by_newer_application
  FROM n16_account_plan
 WHERE new_gender IS NOT NULL OR new_birthday IS NOT NULL
    OR new_address IS NOT NULL OR new_email IS NOT NULL
 ORDER BY account_id;

\echo '== Hồ sơ sẽ có giới thiệu bản thân'
SELECT profile_id, application_id FROM n16_profile_plan ORDER BY profile_id;

\if :apply
-- Không đổi updated_at: nó là mốc "tài khoản có bị sửa sau lúc nhận không" ở
-- trên; tự cập nhật nó thì lần chạy lại sẽ phân loại khác (ghi đè thêm).
UPDATE accounts a
   SET gender = COALESCE(plan.new_gender, a.gender),
       birthday = COALESCE(plan.new_birthday, a.birthday),
       address = COALESCE(plan.new_address, a.address),
       email = COALESCE(plan.new_email, a.email)
  FROM n16_account_plan plan
 WHERE a.id = plan.account_id
   AND (plan.new_gender IS NOT NULL OR plan.new_birthday IS NOT NULL
        OR plan.new_address IS NOT NULL OR plan.new_email IS NOT NULL);

UPDATE employee_profiles e
   SET introduction = plan.new_introduction
  FROM n16_profile_plan plan
 WHERE e.id = plan.profile_id;

COMMIT;
\echo '== Đã ghi.'
\else
ROLLBACK;
\echo '== Xem trước: chưa ghi gì. Thêm -v apply=1 để ghi.'
\endif
