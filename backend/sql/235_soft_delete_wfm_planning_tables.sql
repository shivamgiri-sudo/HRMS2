-- Migration 235: Add soft delete columns to WFM planning tables
-- Purpose: Convert hard DELETE to soft delete for audit trail preservation
-- Risk: LOW — additive only, no data changes
-- Rollback: See ROLLBACK section at end

-- ═══════════════════════════════════════════════════════════════════════════════
-- Add soft delete columns to wfm_slot_requirement
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE wfm_slot_requirement
  ADD COLUMN is_active      TINYINT(1)  NOT NULL DEFAULT 1 COMMENT '0 = soft deleted',
  ADD COLUMN deleted_by     VARCHAR(36) NULL     COMMENT 'FK auth_user.id who soft-deleted this',
  ADD COLUMN deleted_at     DATETIME    NULL     COMMENT 'When soft-deleted',
  ADD COLUMN delete_reason  VARCHAR(500) NULL    COMMENT 'Mandatory reason for deletion';

-- Index for active-only queries
-- MySQL does not support IF NOT EXISTS on CREATE INDEX; guarded instead.
SET @idx_idx_slot_req_active = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_slot_requirement' AND INDEX_NAME = 'idx_slot_req_active'
);
SET @sql = IF(@idx_idx_slot_req_active = 0,
  'CREATE INDEX idx_slot_req_active ON wfm_slot_requirement (is_active)',
  'SELECT ''idx_slot_req_active already exists'' AS n'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Add soft delete columns to process_weekoff_day_rule
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE process_weekoff_day_rule
  ADD COLUMN is_active      TINYINT(1)  NOT NULL DEFAULT 1 COMMENT '0 = soft deleted',
  ADD COLUMN deleted_by     VARCHAR(36) NULL     COMMENT 'FK auth_user.id who soft-deleted this',
  ADD COLUMN deleted_at     DATETIME    NULL     COMMENT 'When soft-deleted',
  ADD COLUMN delete_reason  VARCHAR(500) NULL    COMMENT 'Mandatory reason for deletion';

-- Index for active-only queries
-- MySQL does not support IF NOT EXISTS on CREATE INDEX; guarded instead.
SET @idx_idx_weekoff_rule_active = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'process_weekoff_day_rule' AND INDEX_NAME = 'idx_weekoff_rule_active'
);
SET @sql = IF(@idx_idx_weekoff_rule_active = 0,
  'CREATE INDEX idx_weekoff_rule_active ON process_weekoff_day_rule (is_active)',
  'SELECT ''idx_weekoff_rule_active already exists'' AS n'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ═══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (MySQL 8.0.16+)
-- ═══════════════════════════════════════════════════════════════════════════════
/*
ALTER TABLE wfm_slot_requirement
  DROP COLUMN is_active,
  DROP COLUMN deleted_by,
  DROP COLUMN deleted_at,
  DROP COLUMN delete_reason;

DROP INDEX idx_slot_req_active ON wfm_slot_requirement;

ALTER TABLE process_weekoff_day_rule
  DROP COLUMN is_active,
  DROP COLUMN deleted_by,
  DROP COLUMN deleted_at,
  DROP COLUMN delete_reason;

DROP INDEX idx_weekoff_rule_active ON process_weekoff_day_rule;
*/
