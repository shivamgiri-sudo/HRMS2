-- Migration 235: Add soft delete columns to WFM planning tables
-- Purpose: Convert hard DELETE to soft delete for audit trail preservation
-- Risk: LOW — additive only, no data changes
-- Rollback: See ROLLBACK section at end

-- ═══════════════════════════════════════════════════════════════════════════════
-- Add soft delete columns to wfm_slot_requirement
-- ═══════════════════════════════════════════════════════════════════════════════

SET @mcol_1 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_slot_requirement' AND COLUMN_NAME = 'is_active'
);
SET @msql_1 = IF(@mcol_1 = 0,
  'ALTER TABLE wfm_slot_requirement ADD COLUMN is_active      TINYINT(1)  NOT NULL DEFAULT 1 COMMENT ''0 = soft deleted''',
  'SELECT "is_active already exists" AS message');
PREPARE mstmt_1 FROM @msql_1;
EXECUTE mstmt_1;
DEALLOCATE PREPARE mstmt_1;

SET @mcol_2 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_slot_requirement' AND COLUMN_NAME = 'deleted_by'
);
SET @msql_2 = IF(@mcol_2 = 0,
  'ALTER TABLE wfm_slot_requirement ADD COLUMN deleted_by     VARCHAR(36) NULL     COMMENT ''FK auth_user.id who soft-deleted this''',
  'SELECT "deleted_by already exists" AS message');
PREPARE mstmt_2 FROM @msql_2;
EXECUTE mstmt_2;
DEALLOCATE PREPARE mstmt_2;

SET @mcol_3 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_slot_requirement' AND COLUMN_NAME = 'deleted_at'
);
SET @msql_3 = IF(@mcol_3 = 0,
  'ALTER TABLE wfm_slot_requirement ADD COLUMN deleted_at     DATETIME    NULL     COMMENT ''When soft-deleted''',
  'SELECT "deleted_at already exists" AS message');
PREPARE mstmt_3 FROM @msql_3;
EXECUTE mstmt_3;
DEALLOCATE PREPARE mstmt_3;

SET @mcol_4 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_slot_requirement' AND COLUMN_NAME = 'delete_reason'
);
SET @msql_4 = IF(@mcol_4 = 0,
  'ALTER TABLE wfm_slot_requirement ADD COLUMN delete_reason  VARCHAR(500) NULL    COMMENT ''Mandatory reason for deletion''',
  'SELECT "delete_reason already exists" AS message');
PREPARE mstmt_4 FROM @msql_4;
EXECUTE mstmt_4;
DEALLOCATE PREPARE mstmt_4;

-- Index for active-only queries
SET @midx_9 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_slot_requirement' AND INDEX_NAME = 'idx_slot_req_active'
);
SET @midxsql_9 = IF(@midx_9 = 0,
  'CREATE INDEX idx_slot_req_active ON wfm_slot_requirement(is_active)',
  'SELECT "idx_slot_req_active already exists" AS message');
PREPARE midxstmt_9 FROM @midxsql_9;
EXECUTE midxstmt_9;
DEALLOCATE PREPARE midxstmt_9;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Add soft delete columns to process_weekoff_day_rule
-- ═══════════════════════════════════════════════════════════════════════════════

SET @mcol_5 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'process_weekoff_day_rule' AND COLUMN_NAME = 'is_active'
);
SET @msql_5 = IF(@mcol_5 = 0,
  'ALTER TABLE process_weekoff_day_rule ADD COLUMN is_active      TINYINT(1)  NOT NULL DEFAULT 1 COMMENT ''0 = soft deleted''',
  'SELECT "is_active already exists" AS message');
PREPARE mstmt_5 FROM @msql_5;
EXECUTE mstmt_5;
DEALLOCATE PREPARE mstmt_5;

SET @mcol_6 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'process_weekoff_day_rule' AND COLUMN_NAME = 'deleted_by'
);
SET @msql_6 = IF(@mcol_6 = 0,
  'ALTER TABLE process_weekoff_day_rule ADD COLUMN deleted_by     VARCHAR(36) NULL     COMMENT ''FK auth_user.id who soft-deleted this''',
  'SELECT "deleted_by already exists" AS message');
PREPARE mstmt_6 FROM @msql_6;
EXECUTE mstmt_6;
DEALLOCATE PREPARE mstmt_6;

SET @mcol_7 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'process_weekoff_day_rule' AND COLUMN_NAME = 'deleted_at'
);
SET @msql_7 = IF(@mcol_7 = 0,
  'ALTER TABLE process_weekoff_day_rule ADD COLUMN deleted_at     DATETIME    NULL     COMMENT ''When soft-deleted''',
  'SELECT "deleted_at already exists" AS message');
PREPARE mstmt_7 FROM @msql_7;
EXECUTE mstmt_7;
DEALLOCATE PREPARE mstmt_7;

SET @mcol_8 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'process_weekoff_day_rule' AND COLUMN_NAME = 'delete_reason'
);
SET @msql_8 = IF(@mcol_8 = 0,
  'ALTER TABLE process_weekoff_day_rule ADD COLUMN delete_reason  VARCHAR(500) NULL    COMMENT ''Mandatory reason for deletion''',
  'SELECT "delete_reason already exists" AS message');
PREPARE mstmt_8 FROM @msql_8;
EXECUTE mstmt_8;
DEALLOCATE PREPARE mstmt_8;

-- Index for active-only queries
SET @midx_10 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'process_weekoff_day_rule' AND INDEX_NAME = 'idx_weekoff_rule_active'
);
SET @midxsql_10 = IF(@midx_10 = 0,
  'CREATE INDEX idx_weekoff_rule_active ON process_weekoff_day_rule(is_active)',
  'SELECT "idx_weekoff_rule_active already exists" AS message');
PREPARE midxstmt_10 FROM @midxsql_10;
EXECUTE midxstmt_10;
DEALLOCATE PREPARE midxstmt_10;

-- ═══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (MySQL 8.0.16+)
-- ═══════════════════════════════════════════════════════════════════════════════
/*
ALTER TABLE wfm_slot_requirement
  DROP COLUMN IF EXISTS is_active,
  DROP COLUMN IF EXISTS deleted_by,
  DROP COLUMN IF EXISTS deleted_at,
  DROP COLUMN IF EXISTS delete_reason;

DROP INDEX IF EXISTS idx_slot_req_active ON wfm_slot_requirement;

ALTER TABLE process_weekoff_day_rule
  DROP COLUMN IF EXISTS is_active,
  DROP COLUMN IF EXISTS deleted_by,
  DROP COLUMN IF EXISTS deleted_at,
  DROP COLUMN IF EXISTS delete_reason;

DROP INDEX IF EXISTS idx_weekoff_rule_active ON process_weekoff_day_rule;
*/
