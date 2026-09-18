-- Migration 1808: fix portal_admin_impersonation_log's id columns to match the
-- UUIDs they actually store.
--
-- 0060_portal_admin_impersonation_log.sql declared admin_user_id/portal_user_id as
-- INT UNSIGNED. Both auth_user.id (050_auth_mysql.sql) and client_user.id
-- (012_client_portal.sql) are CHAR(36) UUID primary keys — every INSERT into this table
-- has always failed (a UUID string truncated/coerced into an unsigned int column is not
-- a silent no-op, it is a hard SQL error), so no impersonation attempt has ever been
-- auditable. Since the table has never accepted a real row, there is no existing data to
-- preserve across the type change.
--
-- Guarded via INFORMATION_SCHEMA + PREPARE/EXECUTE, matching this directory's convention
-- for ALTER COLUMN (a bare MODIFY COLUMN is not itself unsafe to re-run, but every other
-- migration here uses the same guard style for consistency and idempotency under retries).

SET @col_type := (
  SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'portal_admin_impersonation_log'
    AND COLUMN_NAME = 'admin_user_id'
);
SET @sql := IF(@col_type IS NOT NULL AND @col_type <> 'char',
  'ALTER TABLE portal_admin_impersonation_log MODIFY COLUMN admin_user_id CHAR(36) NOT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_type2 := (
  SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'portal_admin_impersonation_log'
    AND COLUMN_NAME = 'portal_user_id'
);
SET @sql2 := IF(@col_type2 IS NOT NULL AND @col_type2 <> 'char',
  'ALTER TABLE portal_admin_impersonation_log MODIFY COLUMN portal_user_id CHAR(36) NOT NULL',
  'SELECT 1'
);
PREPARE stmt2 FROM @sql2; EXECUTE stmt2; DEALLOCATE PREPARE stmt2;

-- Add jti so a super-admin-issued impersonation session can be told apart from a real
-- client OTP login in portal_user_sessions/audit review, and so it can be individually
-- revoked (revokeSession(jti)) without touching the client's own real sessions.
SET @has_jti := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'portal_admin_impersonation_log'
    AND COLUMN_NAME = 'jti'
);
SET @sql3 := IF(@has_jti = 0,
  'ALTER TABLE portal_admin_impersonation_log ADD COLUMN jti CHAR(36) NULL AFTER reason',
  'SELECT 1'
);
PREPARE stmt3 FROM @sql3; EXECUTE stmt3; DEALLOCATE PREPARE stmt3;
