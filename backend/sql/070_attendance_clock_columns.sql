-- =====================================================
-- Attendance Clock-In/Out Columns
-- File: 070_attendance_clock_columns.sql
-- Description: Additive migration — adds clock-in/out timestamps, work mode
--              and location columns to attendance_daily_record.
--              Uses INFORMATION_SCHEMA guards for MySQL 8.x compatibility
--              (ADD COLUMN IF NOT EXISTS is not universally supported).
-- =====================================================

USE mas_hrms;

SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_daily_record' AND COLUMN_NAME = 'clock_in_time');
SET @sql = IF(@col = 0, 'ALTER TABLE attendance_daily_record ADD COLUMN clock_in_time DATETIME NULL AFTER record_date', 'SELECT ''clock_in_time already exists'' AS migration_note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_daily_record' AND COLUMN_NAME = 'clock_out_time');
SET @sql = IF(@col = 0, 'ALTER TABLE attendance_daily_record ADD COLUMN clock_out_time DATETIME NULL AFTER clock_in_time', 'SELECT ''clock_out_time already exists'' AS migration_note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_daily_record' AND COLUMN_NAME = 'work_mode');
SET @sql = IF(@col = 0, 'ALTER TABLE attendance_daily_record ADD COLUMN work_mode VARCHAR(50) NULL DEFAULT ''office'' AFTER clock_out_time', 'SELECT ''work_mode already exists'' AS migration_note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_daily_record' AND COLUMN_NAME = 'clock_in_lat');
SET @sql = IF(@col = 0, 'ALTER TABLE attendance_daily_record ADD COLUMN clock_in_lat DECIMAL(10,8) NULL AFTER work_mode', 'SELECT ''clock_in_lat already exists'' AS migration_note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_daily_record' AND COLUMN_NAME = 'clock_in_lng');
SET @sql = IF(@col = 0, 'ALTER TABLE attendance_daily_record ADD COLUMN clock_in_lng DECIMAL(11,8) NULL AFTER clock_in_lat', 'SELECT ''clock_in_lng already exists'' AS migration_note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_daily_record' AND COLUMN_NAME = 'clock_in_location');
SET @sql = IF(@col = 0, 'ALTER TABLE attendance_daily_record ADD COLUMN clock_in_location VARCHAR(255) NULL AFTER clock_in_lng', 'SELECT ''clock_in_location already exists'' AS migration_note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_daily_record' AND COLUMN_NAME = 'clock_out_lat');
SET @sql = IF(@col = 0, 'ALTER TABLE attendance_daily_record ADD COLUMN clock_out_lat DECIMAL(10,8) NULL AFTER clock_in_location', 'SELECT ''clock_out_lat already exists'' AS migration_note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_daily_record' AND COLUMN_NAME = 'clock_out_lng');
SET @sql = IF(@col = 0, 'ALTER TABLE attendance_daily_record ADD COLUMN clock_out_lng DECIMAL(11,8) NULL AFTER clock_out_lat', 'SELECT ''clock_out_lng already exists'' AS migration_note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_daily_record' AND COLUMN_NAME = 'clock_out_location');
SET @sql = IF(@col = 0, 'ALTER TABLE attendance_daily_record ADD COLUMN clock_out_location VARCHAR(255) NULL AFTER clock_out_lng', 'SELECT ''clock_out_location already exists'' AS migration_note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
