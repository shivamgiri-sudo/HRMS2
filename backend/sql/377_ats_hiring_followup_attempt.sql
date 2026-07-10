-- Add is_followup_attempt flag to hiring activity
-- When same mobile+process is logged again on the same day, it's a follow-up call not a unique attempt
SET @col_exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_recruiter_hiring_activity' AND COLUMN_NAME = 'is_followup_attempt');
SET @sql = IF(@col_exists = 0, 'ALTER TABLE ats_recruiter_hiring_activity ADD COLUMN is_followup_attempt TINYINT(1) NOT NULL DEFAULT 0 AFTER followup_reason', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists2 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_recruiter_hiring_activity' AND COLUMN_NAME = 'followup_of_activity_id');
SET @sql2 = IF(@col_exists2 = 0, 'ALTER TABLE ats_recruiter_hiring_activity ADD COLUMN followup_of_activity_id CHAR(36) NULL AFTER is_followup_attempt', 'SELECT 1');
PREPARE stmt2 FROM @sql2; EXECUTE stmt2; DEALLOCATE PREPARE stmt2;
