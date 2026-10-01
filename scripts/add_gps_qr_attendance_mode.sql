-- "GPS + QR (không cần FaceID)" attendance mode.
--
-- Adds:
--   * store_shift_configs.timekeeping_requirement value GPS_QR — the store
--     mode chosen in the owner app ("Yêu cầu chấm công");
--   * attendance_logs.method value QR_GPS — a check-in/out recorded without a
--     face photo, so it stays distinguishable from FACE in history.
--
-- Order: run BEFORE deploying the backend that writes these values. (A
-- backend deployed first fails closed: GPS_QR cannot be saved and every
-- check-in without a photo is refused.)
--
-- Rollback: switch every GPS_QR store to another mode BEFORE redeploying an
-- older backend. Older code still requires a face photo, but does not know
-- GPS_QR and would stop checking QR + GPS for those stores.
--   SELECT store_id FROM store_shift_configs
--    WHERE timekeeping_requirement = 'GPS_QR';
-- Safe to re-run (IF NOT EXISTS). Additive only: existing rows unchanged.
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block on older
-- PostgreSQL, so each statement runs on its own (psql autocommit).
--
-- Run: psql ... -v ON_ERROR_STOP=1 -f scripts/add_gps_qr_attendance_mode.sql

ALTER TYPE store_shift_configs_timekeeping_requirement_enum ADD VALUE IF NOT EXISTS 'GPS_QR';
ALTER TYPE attendance_logs_method_enum ADD VALUE IF NOT EXISTS 'QR_GPS';

-- Verify: both lists end with the new value.
SELECT t.typname, string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) AS labels
  FROM pg_type t
  JOIN pg_enum e ON e.enumtypid = t.oid
 WHERE t.typname IN (
   'store_shift_configs_timekeeping_requirement_enum',
   'attendance_logs_method_enum'
 )
 GROUP BY t.typname;
