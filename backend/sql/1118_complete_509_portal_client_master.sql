-- 1118_complete_509_portal_client_master.sql
--
-- Applies the part of 509_portal_client_master_fixes.sql that never took effect.
--
-- 509 is recorded in schema_migrations as applied on 2026-07-19, and its first two column
-- additions did land - client_master.legal_entity_name and process_master.process_owner_name both
-- exist. Everything after them did not. Traced statement by statement:
--
--   509 guards its client_user ALTER on a single column, COUNT(*) ... COLUMN_NAME='phone'.
--   phone was absent, so the guard passed and built the ALTER. But that ALTER adds eleven columns
--   and an index in one statement, and access_level already existed on client_user. A multi-ADD
--   ALTER is all-or-nothing, so the whole statement failed with ER_DUP_FIELDNAME - which is on the
--   runner's idempotent-error list, so it was swallowed as benign. The file stopped there, and the
--   three CREATE TABLE statements after it never ran.
--
-- The runner no longer discards the rest of a file after one idempotent error; that is fixed
-- separately, in runFileOnConnection. This migration exists because 509 is already recorded
-- applied and so will never be re-run, whatever the runner now does.
--
-- Each column is guarded on itself rather than on a neighbour, which is the whole point: a guard
-- that checks one column and then adds eleven is how this failed in the first place. access_level
-- is deliberately absent from the list below - it already exists, and re-adding it is exactly the
-- statement that broke 509.
--
-- The two CREATE TABLEs are copied from 509 unchanged so the two files cannot disagree. Note that
-- no application code reads portal_user_sessions or portal_user_permissions today - they were
-- scaffolding for portal token revocation and granular permissions - so this restores the intended
-- schema without changing any behaviour on its own.

-- ── client_user: the ten columns 509 intended to add ────────────────────────
SET @ddl = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE client_user ADD COLUMN phone VARCHAR(20) NULL', 'SELECT 1')
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_user' AND COLUMN_NAME = 'phone');
PREPARE s FROM @ddl;
EXECUTE s;
DEALLOCATE PREPARE s;

SET @ddl = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE client_user ADD COLUMN department VARCHAR(100) NULL', 'SELECT 1')
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_user' AND COLUMN_NAME = 'department');
PREPARE s FROM @ddl;
EXECUTE s;
DEALLOCATE PREPARE s;

SET @ddl = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE client_user ADD COLUMN access_start_date DATE NULL', 'SELECT 1')
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_user' AND COLUMN_NAME = 'access_start_date');
PREPARE s FROM @ddl;
EXECUTE s;
DEALLOCATE PREPARE s;

SET @ddl = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE client_user ADD COLUMN access_end_date DATE NULL', 'SELECT 1')
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_user' AND COLUMN_NAME = 'access_end_date');
PREPARE s FROM @ddl;
EXECUTE s;
DEALLOCATE PREPARE s;

SET @ddl = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE client_user ADD COLUMN last_login_at DATETIME NULL', 'SELECT 1')
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_user' AND COLUMN_NAME = 'last_login_at');
PREPARE s FROM @ddl;
EXECUTE s;
DEALLOCATE PREPARE s;

SET @ddl = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE client_user ADD COLUMN last_login_ip VARCHAR(45) NULL', 'SELECT 1')
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_user' AND COLUMN_NAME = 'last_login_ip');
PREPARE s FROM @ddl;
EXECUTE s;
DEALLOCATE PREPARE s;

SET @ddl = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE client_user ADD COLUMN login_count INT NOT NULL DEFAULT 0', 'SELECT 1')
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_user' AND COLUMN_NAME = 'login_count');
PREPARE s FROM @ddl;
EXECUTE s;
DEALLOCATE PREPARE s;

SET @ddl = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE client_user ADD COLUMN deactivated_by CHAR(36) NULL', 'SELECT 1')
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_user' AND COLUMN_NAME = 'deactivated_by');
PREPARE s FROM @ddl;
EXECUTE s;
DEALLOCATE PREPARE s;

SET @ddl = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE client_user ADD COLUMN deactivated_at DATETIME NULL', 'SELECT 1')
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_user' AND COLUMN_NAME = 'deactivated_at');
PREPARE s FROM @ddl;
EXECUTE s;
DEALLOCATE PREPARE s;

SET @ddl = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE client_user ADD COLUMN deactivation_reason TEXT NULL', 'SELECT 1')
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_user' AND COLUMN_NAME = 'deactivation_reason');
PREPARE s FROM @ddl;
EXECUTE s;
DEALLOCATE PREPARE s;

-- Guarded on the index, not on a column: the column above may exist while the index does not.
SET @ddl = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE client_user ADD INDEX idx_last_login (last_login_at)', 'SELECT 1')
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_user' AND INDEX_NAME = 'idx_last_login');
PREPARE s FROM @ddl;
EXECUTE s;
DEALLOCATE PREPARE s;

-- ── The two tables 509 never reached, copied from it unchanged ──────────────
CREATE TABLE IF NOT EXISTS portal_user_sessions (
  id             CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  client_user_id CHAR(36)     NOT NULL,
  jti            VARCHAR(36)  NOT NULL UNIQUE COMMENT 'JWT ID embedded in token for revocation',
  ip_address     VARCHAR(45)  NULL,
  user_agent     TEXT         NULL,
  issued_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at     DATETIME     NOT NULL,
  revoked_at     DATETIME     NULL,
  INDEX idx_pus_user   (client_user_id),
  INDEX idx_pus_jti    (jti),
  INDEX idx_pus_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS portal_user_permissions (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  client_user_id  CHAR(36)     NOT NULL,
  permission_type VARCHAR(100) NOT NULL,
  resource_scope  VARCHAR(100) NULL,
  resource_ids    JSON         NULL,
  granted_by      CHAR(36)     NOT NULL,
  granted_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at      DATETIME     NULL,
  active_status   TINYINT(1)   NOT NULL DEFAULT 1,
  UNIQUE KEY uq_user_perm (client_user_id, permission_type, resource_scope),
  INDEX idx_pup_user (client_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
