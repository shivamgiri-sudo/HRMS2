-- 1251_pnl_snapshot_cc_unique_key.sql
-- Updates pnl_running_salary_snapshot unique key to include cost_centre_id,
-- enabling multiple rows per employee per period when mid-month CC transfer occurs.
--
-- Rollback:
--   ALTER TABLE pnl_running_salary_snapshot
--     DROP INDEX uq_pnl_running_salary,
--     ADD UNIQUE KEY uq_pnl_running_salary (period_code, employee_id);

USE mas_hrms;

-- Drop existing unique key
SET @idx = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'pnl_running_salary_snapshot'
    AND INDEX_NAME = 'uq_pnl_running_salary'
    AND NON_UNIQUE = 0
);
SET @sql = IF(@idx > 0,
  'ALTER TABLE pnl_running_salary_snapshot DROP INDEX uq_pnl_running_salary',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Add new unique key including cost_centre_id
-- NULL cost_centre_id is allowed; MySQL treats NULL != NULL so multiple NULLs per (period,emp) are fine.
-- That is acceptable — employees with no cost centre fall through without conflict.
SET @idx2 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'pnl_running_salary_snapshot'
    AND INDEX_NAME = 'uq_pnl_running_salary'
);
SET @sql2 = IF(@idx2 = 0,
  'ALTER TABLE pnl_running_salary_snapshot ADD UNIQUE KEY uq_pnl_running_salary (period_code, employee_id, cost_centre_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql2; EXECUTE stmt; DEALLOCATE PREPARE stmt;
