-- One-off: plain names for shifts created from approved "Khung giờ khác"
-- requests before the naming fix.
--
-- Approval used to name each shift "Khung giờ khác HH:mm-HH:mm · <tên NV>
-- #<request id>", and staff saw that whole string on Home ("Ca tiếp theo").
-- New approvals name it "Khung giờ khác" (numbered "Khung giờ khác 2", … only
-- when the store already has that name on the same date). This renames the
-- old ones the same way.
--
-- Safe to re-run: only names still in the old pattern are touched. A shift is
-- renamed to "Khung giờ khác" only when no other active shift of the store
-- already uses that name on one of its dates; the rest are listed and left.
--
-- Run: psql ... -v ON_ERROR_STOP=1 -f scripts/rename_custom_shift_names.sql

BEGIN;

-- 1. Preview: old-style names and whether the plain name is free on their dates.
SELECT ws.id, ws.store_id, ws.shift_name,
       EXISTS (
         SELECT 1
           FROM shift_slots ss
           JOIN shift_slots other_ss ON other_ss.work_date = ss.work_date
           JOIN work_shifts other ON other.id = other_ss.work_shift_id
          WHERE ss.work_shift_id = ws.id
            AND other.store_id = ws.store_id
            AND other.id <> ws.id
            AND other.is_active = true
            AND other.shift_name = 'Khung giờ khác'
       ) AS plain_name_taken
  FROM work_shifts ws
 WHERE ws.shift_name ~ '^Khung giờ khác [0-9]{2}:[0-9]{2}-[0-9]{2}:[0-9]{2}.* #[0-9a-f]{6}$'
 ORDER BY ws.created_at;

-- 2. Rename where the plain name is free on every date of the shift.
UPDATE work_shifts ws
   SET shift_name = 'Khung giờ khác',
       updated_at = now()
 WHERE ws.shift_name ~ '^Khung giờ khác [0-9]{2}:[0-9]{2}-[0-9]{2}:[0-9]{2}.* #[0-9a-f]{6}$'
   AND NOT EXISTS (
     SELECT 1
       FROM shift_slots ss
       JOIN shift_slots other_ss ON other_ss.work_date = ss.work_date
       JOIN work_shifts other ON other.id = other_ss.work_shift_id
      WHERE ss.work_shift_id = ws.id
        AND other.store_id = ws.store_id
        AND other.id <> ws.id
        AND other.is_active = true
        AND other.shift_name = 'Khung giờ khác'
   );

-- 3. Verify: anything still in the old pattern (expected 0 unless a date clash).
SELECT count(*) AS still_old_style
  FROM work_shifts
 WHERE shift_name ~ '^Khung giờ khác [0-9]{2}:[0-9]{2}-[0-9]{2}:[0-9]{2}.* #[0-9a-f]{6}$';

COMMIT;
