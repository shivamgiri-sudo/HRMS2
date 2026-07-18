USE mas_hrms;

-- Additive: add per-account brute-force lockout columns to auth_user.
-- Existing rows get safe defaults (0 attempts, no lock).

ALTER TABLE auth_user
  ADD COLUMN IF NOT EXISTS failed_login_attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until DATETIME NULL DEFAULT NULL;

SELECT 'Migration 504 applied: failed_login_attempts and locked_until added to auth_user' AS status;
