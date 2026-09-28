-- Migration 1814: password-based client-portal login, alongside the existing email-OTP flow.
--
-- Adds:
--   client_user.login_id       — the client's login ID (ProcessName_mas convention, generated
--                                 admin-side at portal-user creation time). Independent of
--                                 email; email stays for notifications/password-reset only.
--   client_user.password_hash  — bcrypt, same convention as auth_user.password_hash.
--   client_user.must_change_password — forces a password change on first login, mirroring
--                                 auth_user's own column and employee-activation.service.ts's
--                                 temp-password pattern. A generated password
--                                 (Processname@2026) is guessable by anyone who knows the
--                                 process name, so it must never be treated as permanent.
--   process_master.slug        — URL-safe, unique identifier derived from process_name,
--                                 persisted rather than derived live so a later process rename
--                                 never silently changes an already-shared portal URL. Backs
--                                 the /:slug_clientportal route and the login-id/password
--                                 generator, which both need a stable, collision-free anchor.
--
-- All additive; every guard is idempotent via INFORMATION_SCHEMA + PREPARE/EXECUTE, matching
-- this directory's convention for MySQL 8 (bare "ADD COLUMN IF NOT EXISTS" is rejected here).

SET @has_login_id := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_user' AND COLUMN_NAME = 'login_id'
);
SET @sql := IF(@has_login_id = 0,
  'ALTER TABLE client_user ADD COLUMN login_id VARCHAR(100) NULL AFTER email, ADD UNIQUE KEY uq_client_user_login_id (login_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_password_hash := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_user' AND COLUMN_NAME = 'password_hash'
);
SET @sql2 := IF(@has_password_hash = 0,
  'ALTER TABLE client_user ADD COLUMN password_hash VARCHAR(255) NULL AFTER login_id',
  'SELECT 1'
);
PREPARE stmt2 FROM @sql2; EXECUTE stmt2; DEALLOCATE PREPARE stmt2;

SET @has_must_change := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_user' AND COLUMN_NAME = 'must_change_password'
);
SET @sql3 := IF(@has_must_change = 0,
  'ALTER TABLE client_user ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0 AFTER password_hash',
  'SELECT 1'
);
PREPARE stmt3 FROM @sql3; EXECUTE stmt3; DEALLOCATE PREPARE stmt3;

SET @has_slug := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'process_master' AND COLUMN_NAME = 'slug'
);
SET @sql4 := IF(@has_slug = 0,
  'ALTER TABLE process_master ADD COLUMN slug VARCHAR(150) NULL AFTER process_name, ADD UNIQUE KEY uq_process_master_slug (slug)',
  'SELECT 1'
);
PREPARE stmt4 FROM @sql4; EXECUTE stmt4; DEALLOCATE PREPARE stmt4;
