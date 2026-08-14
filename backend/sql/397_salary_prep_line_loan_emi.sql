-- Migration 397: Add loan_emi column to salary_prep_line for employee loan deductions
--
-- FIXED 2026-08-14: `ADD COLUMN IF NOT EXISTS` is MariaDB syntax, rejected by this production
-- MySQL 8.0.42 build with ER_PARSE_ERROR — same class as the 1006 outage
-- (docs/incidents/2026-08-13-migration-1006-production-outage.md). The column already exists
-- on production (confirmed via information_schema before this fix), so this is a no-op guard
-- rewrite, not a new schema change.
SET @c_loan_emi = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_line' AND COLUMN_NAME = 'loan_emi'
);
SET @sql = IF(@c_loan_emi = 0,
  'ALTER TABLE salary_prep_line ADD COLUMN loan_emi DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER advance_recovery',
  'SELECT "loan_emi already exists" AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
