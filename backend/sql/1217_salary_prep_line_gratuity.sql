-- backend/sql/1217_salary_prep_line_gratuity.sql
-- Adds gratuity employer-cost column to salary_prep_line so that CEO overview
-- people cost matches the Process P&L (which includes gratuity provision).
USE mas_hrms;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'salary_prep_line'
     AND COLUMN_NAME  = 'gratuity') = 0,
  'ALTER TABLE salary_prep_line ADD COLUMN gratuity DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER esic_employer',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
