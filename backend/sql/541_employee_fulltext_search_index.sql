-- Migration 541: FULLTEXT index on employees for fast HR-hub search
-- Replaces triple leading-wildcard LIKE with MATCH...AGAINST (boolean mode).
-- Applied directly to production 2026-07-25; idempotent via information_schema guard.

SET @x = (SELECT COUNT(*) FROM information_schema.STATISTICS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employees'
             AND INDEX_NAME = 'ft_emp_search' AND INDEX_TYPE = 'FULLTEXT');
SET @sql = IF(@x = 0,
  'ALTER TABLE employees ADD FULLTEXT INDEX ft_emp_search (full_name, employee_code, official_email)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
