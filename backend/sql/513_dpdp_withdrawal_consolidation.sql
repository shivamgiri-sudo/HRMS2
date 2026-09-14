-- Migration 370: DPDP Withdrawal Workflow Consolidation
-- Reconciles migrations 293 + 300; adds canonical fields, task table, evidence table.
-- Forward-only, additive, and idempotent through INFORMATION_SCHEMA guards.

-- ── 1. Canonical fields on dpdp_consent_withdrawal ───────────────────────────

SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dpdp_consent_withdrawal' AND COLUMN_NAME = 'reference_number');
SET @sql = IF(@col = 0, 'ALTER TABLE dpdp_consent_withdrawal ADD COLUMN reference_number VARCHAR(32) NULL UNIQUE COMMENT ''Human-readable WDR-XXXXXX reference''', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dpdp_consent_withdrawal' AND COLUMN_NAME = 'requester_ip');
SET @sql = IF(@col = 0, 'ALTER TABLE dpdp_consent_withdrawal ADD COLUMN requester_ip VARCHAR(64) NULL COMMENT ''IP address at submission time''', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dpdp_consent_withdrawal' AND COLUMN_NAME = 'requester_ua');
SET @sql = IF(@col = 0, 'ALTER TABLE dpdp_consent_withdrawal ADD COLUMN requester_ua VARCHAR(512) NULL COMMENT ''User-agent at submission time''', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dpdp_consent_withdrawal' AND COLUMN_NAME = 'notice_version');
SET @sql = IF(@col = 0, 'ALTER TABLE dpdp_consent_withdrawal ADD COLUMN notice_version VARCHAR(32) NULL COMMENT ''Privacy notice version in effect at submission''', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dpdp_consent_withdrawal' AND COLUMN_NAME = 'data_categories');
SET @sql = IF(@col = 0, 'ALTER TABLE dpdp_consent_withdrawal ADD COLUMN data_categories JSON NULL COMMENT ''Data categories the principal wants restricted''', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dpdp_consent_withdrawal' AND COLUMN_NAME = 'implementation_completed_at');
SET @sql = IF(@col = 0, 'ALTER TABLE dpdp_consent_withdrawal ADD COLUMN implementation_completed_at DATETIME NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dpdp_consent_withdrawal' AND COLUMN_NAME = 'closed_at');
SET @sql = IF(@col = 0, 'ALTER TABLE dpdp_consent_withdrawal ADD COLUMN closed_at DATETIME NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dpdp_consent_withdrawal' AND COLUMN_NAME = 'final_decision_by');
SET @sql = IF(@col = 0, 'ALTER TABLE dpdp_consent_withdrawal ADD COLUMN final_decision_by CHAR(36) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dpdp_consent_withdrawal' AND COLUMN_NAME = 'sla_due_at');
SET @sql = IF(@col = 0, 'ALTER TABLE dpdp_consent_withdrawal ADD COLUMN sla_due_at DATETIME NULL COMMENT ''DPDP Act section 13 - 72h SLA deadline''', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dpdp_consent_withdrawal' AND COLUMN_NAME = 'assigned_to');
SET @sql = IF(@col = 0, 'ALTER TABLE dpdp_consent_withdrawal ADD COLUMN assigned_to CHAR(36) NULL COMMENT ''HR/DPO user assigned for review''', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Backfill reference_number for existing records that don't have one
UPDATE dpdp_consent_withdrawal
SET reference_number = CONCAT('WDR-', UPPER(SUBSTRING(id, 1, 12)))
WHERE reference_number IS NULL;

-- Set sla_due_at for existing submitted/in_review requests that are still open
UPDATE dpdp_consent_withdrawal
SET sla_due_at = DATE_ADD(created_at, INTERVAL 72 HOUR)
WHERE sla_due_at IS NULL
  AND status IN ('submitted', 'in_review');

-- ── 2. Ensure from_status / to_status on audit log ───────────────────────────

SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dpdp_withdrawal_audit_log' AND COLUMN_NAME = 'from_status');
SET @sql = IF(@col = 0, 'ALTER TABLE dpdp_withdrawal_audit_log ADD COLUMN from_status VARCHAR(40) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dpdp_withdrawal_audit_log' AND COLUMN_NAME = 'to_status');
SET @sql = IF(@col = 0, 'ALTER TABLE dpdp_withdrawal_audit_log ADD COLUMN to_status VARCHAR(40) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dpdp_withdrawal_audit_log' AND COLUMN_NAME = 'actor_role');
SET @sql = IF(@col = 0, 'ALTER TABLE dpdp_withdrawal_audit_log ADD COLUMN actor_role VARCHAR(50) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dpdp_withdrawal_audit_log' AND COLUMN_NAME = 'ip_address');
SET @sql = IF(@col = 0, 'ALTER TABLE dpdp_withdrawal_audit_log ADD COLUMN ip_address VARCHAR(64) NULL', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── 3. Implementation task table ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dpdp_withdrawal_task (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  withdrawal_id CHAR(36) NOT NULL,
  module_key VARCHAR(80) NOT NULL COMMENT 'e.g. payroll, attendance, documents, ai',
  action_required TEXT NOT NULL,
  status ENUM('pending','in_progress','completed','skipped') NOT NULL DEFAULT 'pending',
  assigned_to CHAR(36) NULL,
  completed_by CHAR(36) NULL,
  completed_at DATETIME NULL,
  notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_dwt_withdrawal (withdrawal_id),
  KEY idx_dwt_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 4. Evidence table ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dpdp_withdrawal_evidence (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  withdrawal_id CHAR(36) NOT NULL,
  evidence_type VARCHAR(60) NOT NULL COMMENT 'e.g. decision_letter, communication_sent, anonymization_proof',
  description TEXT NOT NULL,
  file_ref VARCHAR(255) NULL COMMENT 'Reference to document_vault_inventory.stored_filename',
  recorded_by CHAR(36) NOT NULL,
  recorded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_dwe_withdrawal (withdrawal_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 5. Prevent duplicate active processing holds ─────────────────────────────

SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dpdp_processing_hold' AND COLUMN_NAME = 'entity_type');
SET @sql = IF(@col = 0, 'ALTER TABLE dpdp_processing_hold ADD COLUMN entity_type VARCHAR(50) NULL DEFAULT ''employee'' COMMENT ''Type of entity under hold''', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dpdp_processing_hold' AND COLUMN_NAME = 'entity_id');
SET @sql = IF(@col = 0, 'ALTER TABLE dpdp_processing_hold ADD COLUMN entity_id VARCHAR(36) NULL COMMENT ''ID of entity under hold (employee_id, candidate_id etc)''', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
