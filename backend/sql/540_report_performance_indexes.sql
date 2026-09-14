-- Migration 540: Report query performance indexes
-- Uses information_schema guards (PREPARE/EXECUTE) for idempotency — same pattern as migrations 198, 271, etc.

-- attendance_daily_record: idx_adr_date_branch
SET @x = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_daily_record' AND INDEX_NAME = 'idx_adr_date_branch');
SET @sql = IF(@x = 0, 'ALTER TABLE attendance_daily_record ADD INDEX idx_adr_date_branch (record_date, branch_id)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- attendance_daily_record: idx_adr_date_process
SET @x = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_daily_record' AND INDEX_NAME = 'idx_adr_date_process');
SET @sql = IF(@x = 0, 'ALTER TABLE attendance_daily_record ADD INDEX idx_adr_date_process (record_date, process_id)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- attendance_daily_record: idx_adr_late_mark
SET @x = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_daily_record' AND INDEX_NAME = 'idx_adr_late_mark');
SET @sql = IF(@x = 0, 'ALTER TABLE attendance_daily_record ADD INDEX idx_adr_late_mark (late_mark, record_date)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- wfm_attendance_session: idx_was_date_emp
SET @x = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_attendance_session' AND INDEX_NAME = 'idx_was_date_emp');
SET @sql = IF(@x = 0, 'ALTER TABLE wfm_attendance_session ADD INDEX idx_was_date_emp (session_date, employee_id)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- integration_biometric_daily: idx_ibd_activity_date
SET @x = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'integration_biometric_daily' AND INDEX_NAME = 'idx_ibd_activity_date');
SET @sql = IF(@x = 0, 'ALTER TABLE integration_biometric_daily ADD INDEX idx_ibd_activity_date (activity_date)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
