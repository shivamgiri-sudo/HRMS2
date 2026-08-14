-- Add Branch WFM SPOC tracking columns to attendance_regularization.
-- These preserve manager review details independently of the final WFM SPOC approval.
-- Uses separate ALTER TABLE statements (one per column) for MySQL 8.0 compatibility.
--
-- FIXED 2026-08-14: `ADD COLUMN IF NOT EXISTS` is MariaDB syntax, rejected by this production
-- MySQL 8.0.42 build with ER_PARSE_ERROR — the "MySQL 8.0 compatibility" note above was wrong
-- about which part of the statement MySQL 8.0 actually rejects. All eight columns already
-- exist on production (confirmed via information_schema before this fix), so this is a no-op
-- guard rewrite.
SET @c1 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_regularization' AND COLUMN_NAME = 'manager_reviewer_user_id');
SET @sql = IF(@c1 = 0, 'ALTER TABLE attendance_regularization ADD COLUMN manager_reviewer_user_id CHAR(36) NULL', 'SELECT "manager_reviewer_user_id already exists" AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c2 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_regularization' AND COLUMN_NAME = 'manager_reviewed_at');
SET @sql = IF(@c2 = 0, 'ALTER TABLE attendance_regularization ADD COLUMN manager_reviewed_at DATETIME NULL', 'SELECT "manager_reviewed_at already exists" AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c3 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_regularization' AND COLUMN_NAME = 'manager_review_note');
SET @sql = IF(@c3 = 0, 'ALTER TABLE attendance_regularization ADD COLUMN manager_review_note TEXT NULL', 'SELECT "manager_review_note already exists" AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c4 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_regularization' AND COLUMN_NAME = 'assigned_wfm_spoc_user_id');
SET @sql = IF(@c4 = 0, 'ALTER TABLE attendance_regularization ADD COLUMN assigned_wfm_spoc_user_id CHAR(36) NULL', 'SELECT "assigned_wfm_spoc_user_id already exists" AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c5 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_regularization' AND COLUMN_NAME = 'assigned_wfm_spoc_at');
SET @sql = IF(@c5 = 0, 'ALTER TABLE attendance_regularization ADD COLUMN assigned_wfm_spoc_at DATETIME NULL', 'SELECT "assigned_wfm_spoc_at already exists" AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c6 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_regularization' AND COLUMN_NAME = 'final_wfm_reviewer_user_id');
SET @sql = IF(@c6 = 0, 'ALTER TABLE attendance_regularization ADD COLUMN final_wfm_reviewer_user_id CHAR(36) NULL', 'SELECT "final_wfm_reviewer_user_id already exists" AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c7 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_regularization' AND COLUMN_NAME = 'final_wfm_reviewed_at');
SET @sql = IF(@c7 = 0, 'ALTER TABLE attendance_regularization ADD COLUMN final_wfm_reviewed_at DATETIME NULL', 'SELECT "final_wfm_reviewed_at already exists" AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c8 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_regularization' AND COLUMN_NAME = 'final_wfm_review_note');
SET @sql = IF(@c8 = 0, 'ALTER TABLE attendance_regularization ADD COLUMN final_wfm_review_note TEXT NULL', 'SELECT "final_wfm_review_note already exists" AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
