-- Migration 422: Call Centre Config enhancements + Migration Console operation log
-- Additive only — safe to run on existing production schema

-- 1. UNIQUE index on call_centre_code (partial — MySQL allows multiple NULLs in UNIQUE)
--    Guard: only add if index does not already exist
SET @idx_exists = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'branch_master'
    AND INDEX_NAME = 'uq_branch_cc_code'
);

SET @sql = IF(@idx_exists = 0,
  'ALTER TABLE branch_master ADD UNIQUE INDEX uq_branch_cc_code (call_centre_code)',
  'SELECT ''uq_branch_cc_code already exists'' AS msg'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. Branch integration credentials table
CREATE TABLE IF NOT EXISTS branch_integration_config (
  id              CHAR(36)     NOT NULL DEFAULT (UUID()),
  branch_id       CHAR(36)     NOT NULL,
  config_key      VARCHAR(100) NOT NULL,
  config_value    TEXT         NULL,
  is_secret       TINYINT(1)   NOT NULL DEFAULT 0,
  last_tested_at  DATETIME     NULL,
  test_status     ENUM('ok','fail','untested') NOT NULL DEFAULT 'untested',
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_branch_config (branch_id, config_key),
  INDEX idx_branch (branch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Migration operation log (for Migration Console history view)
CREATE TABLE IF NOT EXISTS migration_operation_log (
  id              INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  operation_type  VARCHAR(80)   NOT NULL,
  triggered_by    CHAR(36)      NULL,
  scanned         INT           NOT NULL DEFAULT 0,
  matched         INT           NOT NULL DEFAULT 0,
  updated_count   INT           NOT NULL DEFAULT 0,
  skipped         INT           NOT NULL DEFAULT 0,
  error_count     INT           NOT NULL DEFAULT 0,
  errors_json     JSON          NULL,
  dry_run         TINYINT(1)    NOT NULL DEFAULT 0,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_op_type (operation_type),
  INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
