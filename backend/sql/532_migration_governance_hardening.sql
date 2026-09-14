-- Migration Governance Hardening
-- Expands schema_migrations table with checksum, audit, and lock tracking

-- Add new columns to schema_migrations for governance
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = 'schema_migrations'
                   AND COLUMN_NAME = 'checksum_sha256');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE schema_migrations ADD COLUMN checksum_sha256 VARCHAR(64) NULL COMMENT "SHA-256 hash of file content at time of application"',
  'SELECT "Column checksum_sha256 already exists" AS message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = 'schema_migrations'
                   AND COLUMN_NAME = 'git_sha');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE schema_migrations ADD COLUMN git_sha VARCHAR(40) NULL COMMENT "Git commit SHA when migration was applied"',
  'SELECT "Column git_sha already exists" AS message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = 'schema_migrations'
                   AND COLUMN_NAME = 'environment');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE schema_migrations ADD COLUMN environment VARCHAR(50) NULL COMMENT "Environment where migration was applied (development, staging, production)"',
  'SELECT "Column environment already exists" AS message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = 'schema_migrations'
                   AND COLUMN_NAME = 'start_time');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE schema_migrations ADD COLUMN start_time DATETIME NULL COMMENT "When migration execution started"',
  'SELECT "Column start_time already exists" AS message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = 'schema_migrations'
                   AND COLUMN_NAME = 'end_time');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE schema_migrations ADD COLUMN end_time DATETIME NULL COMMENT "When migration execution completed"',
  'SELECT "Column end_time already exists" AS message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = 'schema_migrations'
                   AND COLUMN_NAME = 'duration_ms');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE schema_migrations ADD COLUMN duration_ms INT NULL COMMENT "Execution time in milliseconds"',
  'SELECT "Column duration_ms already exists" AS message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = 'schema_migrations'
                   AND COLUMN_NAME = 'executor');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE schema_migrations ADD COLUMN executor VARCHAR(255) NULL COMMENT "User/process that executed the migration"',
  'SELECT "Column executor already exists" AS message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = 'schema_migrations'
                   AND COLUMN_NAME = 'success');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE schema_migrations ADD COLUMN success TINYINT(1) NOT NULL DEFAULT 1 COMMENT "Whether migration completed successfully"',
  'SELECT "Column success already exists" AS message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
                   WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = 'schema_migrations'
                   AND COLUMN_NAME = 'error_message');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE schema_migrations ADD COLUMN error_message TEXT NULL COMMENT "Error message if migration failed"',
  'SELECT "Column error_message already exists" AS message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Migration lock tracking table
CREATE TABLE IF NOT EXISTS migration_lock (
  id              INT           NOT NULL PRIMARY KEY DEFAULT 1,
  locked_by       VARCHAR(255)  NULL COMMENT 'Hostname/process that holds the lock',
  locked_at       DATETIME      NULL,
  lock_expires_at DATETIME      NULL COMMENT 'Auto-expire lock after this time (safety)',
  CONSTRAINT single_lock CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert the single lock row if not exists
INSERT IGNORE INTO migration_lock (id) VALUES (1);

-- Schema version tracking (for startup validation)
CREATE TABLE IF NOT EXISTS schema_version (
  id              INT           NOT NULL PRIMARY KEY DEFAULT 1,
  version         VARCHAR(50)   NOT NULL COMMENT 'Current schema version identifier',
  last_migration  VARCHAR(255)  NULL COMMENT 'Last successfully applied migration filename',
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT single_version CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert initial version if not exists
INSERT IGNORE INTO schema_version (id, version, last_migration) VALUES (1, '0.0.0', NULL);
