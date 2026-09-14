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

-- ─────────────────────────────────────────────────────────────────────────────
-- RUNNING THIS WITHOUT A STAGING DATABASE
--
-- There is no staging environment, so this runs against production. It is built
-- to be safe for that:
--   * Additive only — creates three secondary indexes. No table, column or row
--     is created, altered or deleted, so there is nothing to lose.
--   * ALGORITHM=INPLACE, LOCK=NONE — InnoDB builds each index online and reads
--     and writes continue throughout. If the server cannot honour that it raises
--     an error and changes nothing, rather than silently locking the table.
--   * Idempotent — each statement is skipped when the index already exists, so
--     a re-run is a no-op.
--
-- Before running, size the work (indexes build in proportion to row count):
--   SELECT COUNT(*) FROM apr;
--   SELECT COUNT(*) FROM employees;
--
-- Afterwards, confirm all three exist:
--   SELECT TABLE_NAME, INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
--    WHERE TABLE_SCHEMA = DATABASE()
--      AND INDEX_NAME IN ('idx_apr_user_date',
--                         'idx_emp_biometric_code',
--                         'idx_emp_call_centre_code');
--
-- Rollback (safe at any time — indexes affect speed, never correctness):
--   ALTER TABLE apr       DROP INDEX idx_apr_user_date;
--   ALTER TABLE employees DROP INDEX idx_emp_biometric_code;
--   ALTER TABLE employees DROP INDEX idx_emp_call_centre_code;
--
-- Prefer a low-traffic window: the apr table grows daily per agent per campaign
-- and is the largest of the two.
-- ─────────────────────────────────────────────────────────────────────────────

-- apr: UserID-first lookup for a date range (apr-attendance.service.ts).
SET @idx = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'apr'
              AND INDEX_NAME = 'idx_apr_user_date');
SET @tbl = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'apr');
SET @s = IF(@tbl > 0 AND @idx = 0,
  'ALTER TABLE apr ADD INDEX idx_apr_user_date (UserID, ReportDate), ALGORITHM=INPLACE, LOCK=NONE',
  'SELECT "skip: apr.idx_apr_user_date" AS note');
PREPARE p FROM @s; EXECUTE p; DEALLOCATE PREPARE p;

-- employees.biometric_code: joined by wfm.routes.ts (cosec_punch_sync / cosec_daily_agg)
-- and reporting.service.ts APR builders.
SET @idx = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees'
              AND INDEX_NAME = 'idx_emp_biometric_code');
SET @s = IF(@idx = 0,
  'ALTER TABLE employees ADD INDEX idx_emp_biometric_code (biometric_code), ALGORITHM=INPLACE, LOCK=NONE',
  'SELECT "skip: employees.idx_emp_biometric_code" AS note');
PREPARE p FROM @s; EXECUTE p; DEALLOCATE PREPARE p;

-- employees.call_centre_code: the key the APR vicidial sync worker writes on,
-- and the first candidate used to resolve apr.UserID.
SET @idx = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees'
              AND INDEX_NAME = 'idx_emp_call_centre_code');
SET @s = IF(@idx = 0,
  'ALTER TABLE employees ADD INDEX idx_emp_call_centre_code (call_centre_code), ALGORITHM=INPLACE, LOCK=NONE',
  'SELECT "skip: employees.idx_emp_call_centre_code" AS note');
PREPARE p FROM @s; EXECUTE p; DEALLOCATE PREPARE p;

-- leave_request.legacy_leave_id already has a non-unique index (064_leave_legacy_sync.sql).
-- It is NOT promoted to UNIQUE here on purpose: existing duplicate rows would make
-- that ALTER fail, and de-duplicating live leave history requires a reviewed,
-- separately-approved data migration. Tracked as follow-up.
