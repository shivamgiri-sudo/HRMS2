-- ============================================================
-- Migration 325: Fix biometric timestamps — subtract +05:30 from all
--                biometric tables that were double-offset during batch sync.
--
-- Root cause confirmed:
--   biometric-punch.routes.ts passed punchTime as a JavaScript Date object
--   to mysql2 with timezone:'local' (IST). mysql2 added +5:30 on insert,
--   storing IST+5:30 = UTC+11 instead of the correct IST wall-clock value.
--   E.g., NCOSEC source 10:15:04 IST → stored as 15:45:04 in mas_hrms.
--
-- Fix:
--   CONVERT_TZ(col, '+05:30', '+00:00') subtracts 5h30m from all stored
--   values — converting the incorrectly-stored IST+5:30 back to the
--   correct IST wall-clock time.
--
-- Scope:
--   All rows in the four biometric tables are affected by this bug.
--   is_locked rows in attendance_daily_record are preserved.
--
-- Safety:
--   Wrapped in a single transaction.
-- ============================================================

START TRANSACTION;

-- 1. biometric_attendance_log
UPDATE biometric_attendance_log
SET    first_punch_in  = CONVERT_TZ(first_punch_in,  '+05:30', '+00:00'),
       last_punch_out  = CONVERT_TZ(last_punch_out,  '+05:30', '+00:00')
WHERE  first_punch_in  IS NOT NULL
   OR  last_punch_out  IS NOT NULL;

-- 2. integration_biometric_daily
UPDATE integration_biometric_daily
SET    first_punch = CONVERT_TZ(first_punch, '+05:30', '+00:00'),
       last_punch  = CONVERT_TZ(last_punch,  '+05:30', '+00:00')
WHERE  first_punch IS NOT NULL
   OR  last_punch  IS NOT NULL;

-- 3. wfm_attendance_session
UPDATE wfm_attendance_session
SET    login_time   = CONVERT_TZ(login_time,  '+05:30', '+00:00'),
       logout_time  = CONVERT_TZ(logout_time, '+05:30', '+00:00')
WHERE  punch_source = 'BIOMETRIC'
  AND (login_time  IS NOT NULL
   OR  logout_time IS NOT NULL);

-- 4. attendance_daily_record — skip locked rows
UPDATE attendance_daily_record
SET    clock_in_time  = CONVERT_TZ(clock_in_time,  '+05:30', '+00:00'),
       clock_out_time = CONVERT_TZ(clock_out_time, '+05:30', '+00:00')
WHERE  is_locked = 0
  AND (clock_in_time  IS NOT NULL
   OR  clock_out_time IS NOT NULL);

COMMIT;

-- Verification (run after migration):
-- SELECT employee_code, punch_date, first_punch_in, last_punch_out FROM biometric_attendance_log WHERE employee_code='MAS47814' ORDER BY punch_date DESC LIMIT 5;
-- SELECT employee_code, activity_date, first_punch, last_punch FROM integration_biometric_daily WHERE employee_code='MAS47814' ORDER BY activity_date DESC LIMIT 5;
-- SELECT employee_id, record_date, clock_in_time, clock_out_time FROM attendance_daily_record WHERE employee_id = (SELECT id FROM employees WHERE employee_code='MAS47814') ORDER BY record_date DESC LIMIT 5;
