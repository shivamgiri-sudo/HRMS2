-- ================================================================
-- Password Expiry Policy Migration
-- ================================================================
-- Adds password_changed_at column to auth_user table to support
-- automatic password expiry after 90 days.
--
-- Security Feature: Forces users to change passwords regularly
-- to comply with password policy guidelines.
-- ================================================================

USE mas_hrms;

-- Add password_changed_at column if it doesn't exist
-- Check if column exists first, then add
SET @col_exists = (SELECT COUNT(*)
                   FROM INFORMATION_SCHEMA.COLUMNS
                   WHERE TABLE_SCHEMA = 'mas_hrms'
                   AND TABLE_NAME = 'auth_user'
                   AND COLUMN_NAME = 'password_changed_at');

SET @sql = IF(@col_exists = 0,
  'ALTER TABLE auth_user ADD COLUMN password_changed_at DATETIME NULL COMMENT "Timestamp of last password change for expiry policy" AFTER must_change_password',
  'SELECT "Column password_changed_at already exists" AS message');

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- For existing users without a password_changed_at value,
-- set it to the created_at timestamp (assume password was set at account creation)
UPDATE auth_user
   SET password_changed_at = created_at
 WHERE password_changed_at IS NULL;

-- Add index for efficient password expiry queries
SET @idx_exists = (SELECT COUNT(*)
                   FROM INFORMATION_SCHEMA.STATISTICS
                   WHERE TABLE_SCHEMA = 'mas_hrms'
                   AND TABLE_NAME = 'auth_user'
                   AND INDEX_NAME = 'idx_password_changed_at');

SET @sql = IF(@idx_exists = 0,
  'CREATE INDEX idx_password_changed_at ON auth_user(password_changed_at)',
  'SELECT "Index idx_password_changed_at already exists" AS message');

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ================================================================
-- Password History Table (for preventing password reuse)
-- ================================================================
CREATE TABLE IF NOT EXISTS auth_password_history (
  id                CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  user_id           CHAR(36)     NOT NULL,
  password_hash     VARCHAR(255) NOT NULL,
  changed_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (user_id) REFERENCES auth_user(id) ON DELETE CASCADE,
  INDEX idx_user_history (user_id, changed_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT 'Password history for preventing reuse of recent passwords';

-- ================================================================
-- Password Policy Configuration Table
-- ================================================================
CREATE TABLE IF NOT EXISTS auth_password_policy (
  id                        CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  expiry_days               INT          NOT NULL DEFAULT 90
    COMMENT 'Days until password expires and must be changed',
  history_count             INT          NOT NULL DEFAULT 5
    COMMENT 'Number of previous passwords to prevent reuse',
  min_length                INT          NOT NULL DEFAULT 8,
  require_uppercase         TINYINT(1)   NOT NULL DEFAULT 1,
  require_lowercase         TINYINT(1)   NOT NULL DEFAULT 1,
  require_number            TINYINT(1)   NOT NULL DEFAULT 1,
  require_special_char      TINYINT(1)   NOT NULL DEFAULT 1,
  updated_at                DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by                CHAR(36)     NULL,

  UNIQUE KEY unique_policy (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT 'Global password policy configuration';

-- Insert default policy if not exists
INSERT INTO auth_password_policy (id, expiry_days, history_count, min_length)
VALUES ('default', 90, 5, 8)
ON DUPLICATE KEY UPDATE id = id;

-- ================================================================
-- COMPLETED
-- ================================================================
