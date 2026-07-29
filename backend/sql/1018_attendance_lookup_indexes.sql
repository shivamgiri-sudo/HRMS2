-- 1018_attendance_lookup_indexes.sql
-- Additive, idempotent indexes for the Attendance Lookup page (/hr/attendance-lookup).
--
-- Context: the page now reads APR (dialler) attendance from mas_hrms.apr in
-- addition to biometric COSEC data. `apr` is keyed (ReportDate, UserID, campaign_id),
-- so a UserID-first lookup could not use the primary key prefix. `employees`
-- is joined on biometric_code / call_centre_code in several attendance and
-- reporting paths with no supporting index.
--
-- No data is modified. Safe to re-run: each statement is guarded against an
-- existing index of the same name.

-- apr: UserID-first lookup for a date range (apr-attendance.service.ts).
SET @idx = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'apr'
              AND INDEX_NAME = 'idx_apr_user_date');
SET @tbl = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'apr');
SET @s = IF(@tbl > 0 AND @idx = 0,
  'ALTER TABLE apr ADD INDEX idx_apr_user_date (UserID, ReportDate)',
  'SELECT "skip: apr.idx_apr_user_date" AS note');
PREPARE p FROM @s; EXECUTE p; DEALLOCATE PREPARE p;

-- employees.biometric_code: joined by wfm.routes.ts (cosec_punch_sync / cosec_daily_agg)
-- and reporting.service.ts APR builders.
SET @idx = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees'
              AND INDEX_NAME = 'idx_emp_biometric_code');
SET @s = IF(@idx = 0,
  'ALTER TABLE employees ADD INDEX idx_emp_biometric_code (biometric_code)',
  'SELECT "skip: employees.idx_emp_biometric_code" AS note');
PREPARE p FROM @s; EXECUTE p; DEALLOCATE PREPARE p;

-- employees.call_centre_code: the key the APR vicidial sync worker writes on,
-- and the first candidate used to resolve apr.UserID.
SET @idx = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees'
              AND INDEX_NAME = 'idx_emp_call_centre_code');
SET @s = IF(@idx = 0,
  'ALTER TABLE employees ADD INDEX idx_emp_call_centre_code (call_centre_code)',
  'SELECT "skip: employees.idx_emp_call_centre_code" AS note');
PREPARE p FROM @s; EXECUTE p; DEALLOCATE PREPARE p;

-- leave_request.legacy_leave_id already has a non-unique index (064_leave_legacy_sync.sql).
-- It is NOT promoted to UNIQUE here on purpose: existing duplicate rows would make
-- that ALTER fail, and de-duplicating live leave history requires a reviewed,
-- separately-approved data migration. Tracked as follow-up.
