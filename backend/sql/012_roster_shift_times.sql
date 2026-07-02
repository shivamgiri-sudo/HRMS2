-- 012_roster_shift_times.sql
-- Add per-assignment shift override times so CSV upload can set individual
-- start/end times without touching the shift master.
-- Uses INFORMATION_SCHEMA guards instead of ADD COLUMN IF NOT EXISTS
-- for compatibility with all MySQL 8.x versions.
USE mas_hrms;

SET @col = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'wfm_roster_assignment'
    AND COLUMN_NAME  = 'shift_start_time'
);
SET @sql = IF(@col = 0,
  'ALTER TABLE wfm_roster_assignment ADD COLUMN shift_start_time VARCHAR(5) NULL COMMENT ''HH:MM override, NULL = use shift master'' AFTER roster_status',
  'SELECT ''shift_start_time already exists'' AS migration_note'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'wfm_roster_assignment'
    AND COLUMN_NAME  = 'shift_end_time'
);
SET @sql = IF(@col = 0,
  'ALTER TABLE wfm_roster_assignment ADD COLUMN shift_end_time VARCHAR(5) NULL COMMENT ''HH:MM override, NULL = use shift master'' AFTER shift_start_time',
  'SELECT ''shift_end_time already exists'' AS migration_note'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
