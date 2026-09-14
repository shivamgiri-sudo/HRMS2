-- Additive: add per-account brute-force lockout columns to auth_user.
-- Existing rows get safe defaults (0 attempts, no lock).
--
-- FIXED 2026-08-14: `ADD COLUMN IF NOT EXISTS` is MariaDB syntax, rejected by this production
-- MySQL 8.0.42 build with ER_PARSE_ERROR — same class as the 1006 outage. Both columns already
-- exist on production (confirmed via information_schema before this fix), so this is a no-op
-- guard rewrite.
SET @c1 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auth_user' AND COLUMN_NAME = 'failed_login_attempts');
SET @sql = IF(@c1 = 0, 'ALTER TABLE auth_user ADD COLUMN failed_login_attempts INT NOT NULL DEFAULT 0', 'SELECT "failed_login_attempts already exists" AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c2 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auth_user' AND COLUMN_NAME = 'locked_until');
SET @sql = IF(@c2 = 0, 'ALTER TABLE auth_user ADD COLUMN locked_until DATETIME NULL DEFAULT NULL', 'SELECT "locked_until already exists" AS info');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT 'Migration 504 applied: failed_login_attempts and locked_until added to auth_user' AS status;
