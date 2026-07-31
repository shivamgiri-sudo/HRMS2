-- Salary certificate history: make salary_certificate_request joinable to employees.
--
-- GET /api/payroll/salary-certificates/employee/:employeeId joins
--   employees e ON e.id = scr.employee_id
-- and returned 500 for every caller. Verified against production 2026-07-31:
--   ERROR 1267 (HY000): Illegal mix of collations
--     (utf8mb4_unicode_ci,IMPLICIT) and (utf8mb4_0900_ai_ci,IMPLICIT) for operation '='
--
-- salary_certificate_request was created without the explicit
--   DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
-- that every other table in this schema declares, so it inherited MySQL 8's
-- server default utf8mb4_0900_ai_ci. employees is utf8mb4_unicode_ci, and MySQL
-- refuses to compare CHAR/VARCHAR across those two collations. The clash is in
-- the join predicate itself, so it fires for every id — there is no input that
-- could have succeeded.
--
-- Safe to convert: the table holds 0 rows in production (checked 2026-07-31), so
-- there is nothing to re-encode and no index to rebuild against live content.
-- Additive in effect — no column added, dropped or renamed, character set stays
-- utf8mb4; only the collation changes.
--
-- NOTE: ~30 other tables in mas_hrms carry the same server default, several very
-- large (cosec_punch_sync ~3.0M rows, cosec_daily_agg ~278k, cosec_unmapped_users
-- ~91k, migration_log ~90k). They are deliberately NOT touched here: CONVERT TO
-- rewrites the whole table under a metadata lock, which is a maintenance-window
-- operation needing its own approval. This migration fixes only the table behind
-- the confirmed broken endpoint.

SET @needs_convert = (
  SELECT COUNT(*)
    FROM information_schema.TABLES
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'salary_certificate_request'
     AND TABLE_COLLATION <> 'utf8mb4_unicode_ci'
);

SET @sql = IF(
  @needs_convert = 1,
  'ALTER TABLE salary_certificate_request CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
