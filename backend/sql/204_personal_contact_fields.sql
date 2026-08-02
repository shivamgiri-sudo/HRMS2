-- Migration: Add personal contact fields to employees table
-- Date: 2026-06-17
-- Description: Add personal_email and personal_mobile fields for employees to maintain separate personal contact info

ALTER TABLE employees 
ADD COLUMN personal_email VARCHAR(255) NULL COMMENT 'Employee personal email address',
ADD COLUMN personal_mobile VARCHAR(20) NULL COMMENT 'Employee personal mobile number';

-- Add index for personal email for faster lookups
-- MySQL does not support IF NOT EXISTS on CREATE INDEX; guarded instead.
-- The COLUMN is checked as well as the index: on a fresh database the two are different
-- questions, and 138 indexed ats_candidate(branch_name) on a table that has no such column.
SET @idx_idx_employees_personal_email = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND INDEX_NAME = 'idx_employees_personal_email'
);
SET @col_idx_employees_personal_email = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees' AND COLUMN_NAME IN ('personal_email')
);
SET @sql = IF(@idx_idx_employees_personal_email = 0 AND @col_idx_employees_personal_email = 1,
  'CREATE INDEX idx_employees_personal_email ON employees (personal_email)',
  'SELECT ''idx_employees_personal_email skipped: already present, or a column it indexes does not exist'' AS n'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
