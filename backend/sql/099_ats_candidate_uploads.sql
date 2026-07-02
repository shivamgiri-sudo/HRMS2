-- 099_ats_candidate_uploads.sql
-- Add columns for candidate file uploads (resume, selfie)
-- Uses INFORMATION_SCHEMA guards for MySQL 8.x compatibility.
USE mas_hrms;

SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'resume_url');
SET @sql = IF(@col = 0, 'ALTER TABLE ats_candidate ADD COLUMN resume_url VARCHAR(500) NULL COMMENT ''URL/path to uploaded resume''', 'SELECT ''resume_url already exists'' AS migration_note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_candidate' AND COLUMN_NAME = 'selfie_url');
SET @sql = IF(@col = 0, 'ALTER TABLE ats_candidate ADD COLUMN selfie_url VARCHAR(500) NULL COMMENT ''URL/path to uploaded selfie photo''', 'SELECT ''selfie_url already exists'' AS migration_note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
