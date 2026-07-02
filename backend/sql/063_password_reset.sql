-- Migration 063: Password Reset System
-- Enables forgot password / reset password functionality
-- Date: 2026-06-07

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  reset_token VARCHAR(64) NOT NULL UNIQUE,
  reset_code VARCHAR(6) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_id (user_id),
  INDEX idx_reset_token (reset_token),
  INDEX idx_reset_code (reset_code),
  INDEX idx_expires_at (expires_at),
  FOREIGN KEY (user_id) REFERENCES auth_user(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Auto-generate UUIDs
ALTER TABLE password_reset_tokens MODIFY id CHAR(36) NOT NULL DEFAULT (UUID());

SELECT 'Migration 063 complete: Password reset system ready' AS status;
