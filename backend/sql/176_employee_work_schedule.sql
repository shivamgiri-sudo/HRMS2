USE mas_hrms;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'employees'
     AND COLUMN_NAME = 'working_hours_start') = 0,
  'ALTER TABLE employees ADD COLUMN working_hours_start TIME NULL DEFAULT ''09:00:00'' AFTER reporting_manager_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'employees'
     AND COLUMN_NAME = 'working_hours_end') = 0,
  'ALTER TABLE employees ADD COLUMN working_hours_end TIME NULL DEFAULT ''18:00:00'' AFTER working_hours_start',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'employees'
     AND COLUMN_NAME = 'working_days') = 0,
  'ALTER TABLE employees ADD COLUMN working_days JSON NULL AFTER working_hours_end',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
