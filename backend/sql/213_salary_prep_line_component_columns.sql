-- Migration 213: Add missing component columns to salary_prep_line
-- basic, hra, special_allowance were calculated but never persisted.
-- tds_amount, lwp_deduction, advance_recovery were also missing.

-- Check and add each column separately (compatible with MySQL < 8.0.29)
SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_line' AND COLUMN_NAME = 'basic';
SET @sql = IF(@col_exists = 0, 'ALTER TABLE salary_prep_line ADD COLUMN basic DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER dialer_hours', 'SELECT "Column basic already exists"');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_line' AND COLUMN_NAME = 'hra';
SET @sql = IF(@col_exists = 0, 'ALTER TABLE salary_prep_line ADD COLUMN hra DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER basic', 'SELECT "Column hra already exists"');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_line' AND COLUMN_NAME = 'special_allowance';
SET @sql = IF(@col_exists = 0, 'ALTER TABLE salary_prep_line ADD COLUMN special_allowance DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER hra', 'SELECT "Column special_allowance already exists"');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_line' AND COLUMN_NAME = 'tds_amount';
SET @sql = IF(@col_exists = 0, 'ALTER TABLE salary_prep_line ADD COLUMN tds_amount DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER tds', 'SELECT "Column tds_amount already exists"');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_line' AND COLUMN_NAME = 'lwp_deduction';
SET @sql = IF(@col_exists = 0, 'ALTER TABLE salary_prep_line ADD COLUMN lwp_deduction DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER tds_amount', 'SELECT "Column lwp_deduction already exists"');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists = 0;
SELECT COUNT(*) INTO @col_exists FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_line' AND COLUMN_NAME = 'advance_recovery';
SET @sql = IF(@col_exists = 0, 'ALTER TABLE salary_prep_line ADD COLUMN advance_recovery DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER lwp_deduction', 'SELECT "Column advance_recovery already exists"');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
