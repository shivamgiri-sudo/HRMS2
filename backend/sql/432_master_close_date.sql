-- 432_master_close_date.sql
-- Adds close_date to branch/process/department masters so a deactivated master record can say
-- WHEN it went inactive, matching what cost_centre_master already supports.
--
-- Today only cost_centre_master has close_date; the other three masters carry a bare
-- active_status with no date, so "inactive since when" is unanswerable for them and the UI has
-- nothing to display or filter on. Additive and nullable — existing rows and every current query
-- are unaffected.
--
-- Rollback (manual, if ever needed):
--   ALTER TABLE branch_master     DROP COLUMN close_date;
--   ALTER TABLE process_master    DROP COLUMN close_date;
--   ALTER TABLE department_master DROP COLUMN close_date;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'branch_master' AND column_name = 'close_date') = 0,
  'ALTER TABLE branch_master ADD COLUMN close_date DATE NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'process_master' AND column_name = 'close_date') = 0,
  'ALTER TABLE process_master ADD COLUMN close_date DATE NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'department_master' AND column_name = 'close_date') = 0,
  'ALTER TABLE department_master ADD COLUMN close_date DATE NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
