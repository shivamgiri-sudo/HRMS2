-- Migration 235: Add soft delete columns to WFM planning tables
-- Purpose: Convert hard DELETE to soft delete for audit trail preservation
-- Risk: LOW — additive only, no data changes
-- Rollback: See ROLLBACK section at end

-- ═══════════════════════════════════════════════════════════════════════════════
-- Add soft delete columns to wfm_slot_requirement
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE wfm_slot_requirement
  ADD COLUMN IF NOT EXISTS is_active      TINYINT(1)  NOT NULL DEFAULT 1 COMMENT '0 = soft deleted',
  ADD COLUMN IF NOT EXISTS deleted_by     VARCHAR(36) NULL     COMMENT 'FK auth_user.id who soft-deleted this',
  ADD COLUMN IF NOT EXISTS deleted_at     DATETIME    NULL     COMMENT 'When soft-deleted',
  ADD COLUMN IF NOT EXISTS delete_reason  VARCHAR(500) NULL    COMMENT 'Mandatory reason for deletion';

-- Index for active-only queries
CREATE INDEX IF NOT EXISTS idx_slot_req_active ON wfm_slot_requirement(is_active);

-- ═══════════════════════════════════════════════════════════════════════════════
-- Add soft delete columns to process_weekoff_day_rule
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE process_weekoff_day_rule
  ADD COLUMN IF NOT EXISTS is_active      TINYINT(1)  NOT NULL DEFAULT 1 COMMENT '0 = soft deleted',
  ADD COLUMN IF NOT EXISTS deleted_by     VARCHAR(36) NULL     COMMENT 'FK auth_user.id who soft-deleted this',
  ADD COLUMN IF NOT EXISTS deleted_at     DATETIME    NULL     COMMENT 'When soft-deleted',
  ADD COLUMN IF NOT EXISTS delete_reason  VARCHAR(500) NULL    COMMENT 'Mandatory reason for deletion';

-- Index for active-only queries
CREATE INDEX IF NOT EXISTS idx_weekoff_rule_active ON process_weekoff_day_rule(is_active);

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
