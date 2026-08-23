-- Migration 1552: Add updated_at to employee_salary_assignment.
-- payroll-head-review.service.ts UPDATE sets updated_at = NOW() on every salary-package confirmation.
-- The column was never created; the UPDATE silently fails via .catch() on every call.
-- Additive and idempotent: information_schema-guarded, nullable (no default needed, existing rows read NULL).

SET @db = DATABASE();

SELECT COUNT(*) INTO @has_ua
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'employee_salary_assignment' AND COLUMN_NAME = 'updated_at';
SET @sql = IF(@has_ua = 0,
  'ALTER TABLE employee_salary_assignment
     ADD COLUMN updated_at DATETIME NULL AFTER created_at',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
