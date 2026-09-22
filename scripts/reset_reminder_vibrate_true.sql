-- =============================================
-- One-time data repair: turn shift-reminder vibration back on.
--
-- Context: every staff build before 969a029 initialised the "Rung thông báo"
-- switch to OFF and sent it on Save, so anyone who ever saved the old reminder
-- screen has reminder_settings.vibrate = false without having chosen it. The
-- backend then sends every shift push (pre-shift reminder, +5 not-checked-in,
-- end-of-shift +0/+5/+10, auto-checkout, absent) to the silent Android channel
-- 'shift-alerts-quiet'. Product decision: reset vibrate to true for everyone
-- once.
--
-- Only the `vibrate` key changes; every other saved key (type, custom,
-- fixedTime, remindIfNotCheckIn, notifyNewShifts, ...) is preserved.
--
-- No job rescheduling is needed after this script:
--   * The pre-shift reminder job's schedule fingerprint does not include
--     `vibrate` (shift-reminder.utils.ts getShiftReminderPreferenceFingerprint),
--     so queued jobs stay valid; ShiftReminderProcessor re-reads
--     employee.reminder_settings when the job fires and picks the channel then.
--   * The +5 / absent reminders (per-minute cron) and the end-of-shift /
--     auto-checkout jobs also read reminder_settings at send time.
--   So the next push after this script already uses 'shift-alerts' (vibrating).
--
-- Idempotent: a second run matches 0 rows. Do not run without verifying the
-- target database. Users can still turn vibration off again in the app.
-- =============================================

-- 0) Preflight (read-only): how many profiles will change.
SELECT count(*) AS profiles_with_vibrate_false
FROM employee_profiles
WHERE deleted_at IS NULL
  AND reminder_settings IS NOT NULL
  AND jsonb_typeof(reminder_settings) = 'object'
  AND reminder_settings->>'vibrate' = 'false';

-- 1) Apply.
BEGIN;

UPDATE employee_profiles
SET reminder_settings = jsonb_set(reminder_settings, '{vibrate}', 'true'::jsonb, true),
    updated_at = now()
WHERE deleted_at IS NULL
  AND reminder_settings IS NOT NULL
  AND jsonb_typeof(reminder_settings) = 'object'
  AND reminder_settings->>'vibrate' = 'false';

-- Check the reported row count equals the preflight count, then:
COMMIT;
-- (or ROLLBACK; if the count differs)

-- 2) Verify (read-only): must return 0.
SELECT count(*) AS still_vibrate_false
FROM employee_profiles
WHERE deleted_at IS NULL
  AND reminder_settings IS NOT NULL
  AND jsonb_typeof(reminder_settings) = 'object'
  AND reminder_settings->>'vibrate' = 'false';

-- 2b) Verify (read-only): distribution after the change.
SELECT reminder_settings->>'type' AS type,
       COALESCE(reminder_settings->>'vibrate', '(default true)') AS vibrate,
       count(*)
FROM employee_profiles
WHERE deleted_at IS NULL
GROUP BY 1, 2
ORDER BY 3 DESC;
