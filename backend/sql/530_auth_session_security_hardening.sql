-- Auth Session Security Hardening
-- Adds pre_auth_challenge table for secure 2FA flow
-- Adds token family columns for refresh token rotation and reuse detection
-- Adds session invalidation tracking columns

-- Pre-auth challenge table for secure 2FA flow
-- Stores challenge state BEFORE issuing any refresh token
CREATE TABLE IF NOT EXISTS pre_auth_challenge (
  id              VARCHAR(36)   NOT NULL PRIMARY KEY,
  user_id         VARCHAR(36)   NOT NULL,
  challenge_type  ENUM('2fa', 'password_change') NOT NULL DEFAULT '2fa',
  issued_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at      DATETIME      NOT NULL,
  consumed_at     DATETIME      NULL,
  ip_address      VARCHAR(45)   NULL,
  user_agent      VARCHAR(512)  NULL,
  INDEX idx_pre_auth_user_id (user_id),
  INDEX idx_pre_auth_expires (expires_at),
  INDEX idx_pre_auth_consumed (consumed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add token family columns to auth_refresh_token for rotation and reuse detection
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = 'auth_refresh_token'
                   AND COLUMN_NAME = 'token_family_id');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE auth_refresh_token ADD COLUMN token_family_id VARCHAR(36) NULL COMMENT "Groups related tokens for reuse detection"',
  'SELECT "Column token_family_id already exists" AS message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = 'auth_refresh_token'
                   AND COLUMN_NAME = 'previous_token_hash');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE auth_refresh_token ADD COLUMN previous_token_hash VARCHAR(128) NULL COMMENT "Hash of the token this one replaced"',
  'SELECT "Column previous_token_hash already exists" AS message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = 'auth_refresh_token'
                   AND COLUMN_NAME = 'rotated_at');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE auth_refresh_token ADD COLUMN rotated_at DATETIME NULL COMMENT "When this token was rotated out"',
  'SELECT "Column rotated_at already exists" AS message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = 'auth_refresh_token'
                   AND COLUMN_NAME = 'password_changed_at_snapshot');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE auth_refresh_token ADD COLUMN password_changed_at_snapshot DATETIME NULL COMMENT "User password_changed_at when token was issued"',
  'SELECT "Column password_changed_at_snapshot already exists" AS message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Index for token family queries
SET @idx_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
                   WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = 'auth_refresh_token'
                   AND INDEX_NAME = 'idx_refresh_token_family');
SET @sql = IF(@idx_exists = 0,
  'CREATE INDEX idx_refresh_token_family ON auth_refresh_token(token_family_id)',
  'SELECT "Index idx_refresh_token_family already exists" AS message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Index for rotated token detection
SET @idx_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
                   WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = 'auth_refresh_token'
                   AND INDEX_NAME = 'idx_refresh_token_rotated');
SET @sql = IF(@idx_exists = 0,
  'CREATE INDEX idx_refresh_token_rotated ON auth_refresh_token(rotated_at)',
  'SELECT "Index idx_refresh_token_rotated already exists" AS message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add session_version to auth_user for forced logout on security events
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = 'auth_user'
                   AND COLUMN_NAME = 'session_version');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE auth_user ADD COLUMN session_version INT NOT NULL DEFAULT 1 COMMENT "Incremented on password change or security event to invalidate all sessions"',
  'SELECT "Column session_version already exists" AS message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Token reuse security event type in security_audit_event (if table exists)
-- This is for logging when token reuse is detected
SET @table_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
                     WHERE TABLE_SCHEMA = DATABASE()
                     AND TABLE_NAME = 'security_audit_event');
-- Note: security_audit_event already uses VARCHAR for event_type, so no schema change needed

-- Auth invitation table for controlled registration
CREATE TABLE IF NOT EXISTS auth_invitation (
  id              VARCHAR(36)   NOT NULL PRIMARY KEY,
  email           VARCHAR(255)  NOT NULL,
  invited_by      VARCHAR(36)   NOT NULL COMMENT 'User ID who created the invitation',
  invitation_type ENUM('hr_invite', 'admin_provision', 'employee_activation') NOT NULL DEFAULT 'hr_invite',
  token_hash      VARCHAR(128)  NOT NULL COMMENT 'SHA-256 hash of the invitation token',
  expires_at      DATETIME      NOT NULL,
  consumed_at     DATETIME      NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_invitation_email (email),
  INDEX idx_invitation_token (token_hash),
  INDEX idx_invitation_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
