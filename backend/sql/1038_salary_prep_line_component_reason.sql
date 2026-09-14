-- Migration 1038: Add reason column to salary_prep_line_component
-- Stores human-readable reason for each earning/deduction component shown on payslips.
-- Nullable so all existing rows are unaffected.
--
-- FIXED 2026-08-14: `ADD COLUMN IF NOT EXISTS` is MariaDB syntax, rejected by this production
-- MySQL 8.0.42 build with ER_PARSE_ERROR. The column already exists on production (confirmed
-- via information_schema before this fix), so this is a no-op guard rewrite.
SET @c1 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_line_component' AND COLUMN_NAME = 'reason');
SET @sql = IF(@c1 = 0, 'ALTER TABLE salary_prep_line_component ADD COLUMN reason VARCHAR(500) NULL AFTER amount', 'SELECT "reason already exists" AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
