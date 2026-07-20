-- Migration 370: DPDP Withdrawal Workflow Consolidation
-- Reconciles migrations 293 + 300; adds canonical fields, task table, evidence table.
-- Forward-only, additive, idempotent (all ADD COLUMN use IF NOT EXISTS guard).

-- ── 1. Canonical fields on dpdp_consent_withdrawal ───────────────────────────

ALTER TABLE dpdp_consent_withdrawal
  ADD COLUMN IF NOT EXISTS reference_number VARCHAR(32) NULL UNIQUE COMMENT 'Human-readable WDR-XXXXXX reference',
  ADD COLUMN IF NOT EXISTS requester_ip VARCHAR(64) NULL COMMENT 'IP address at submission time',
  ADD COLUMN IF NOT EXISTS requester_ua VARCHAR(512) NULL COMMENT 'User-agent at submission time',
  ADD COLUMN IF NOT EXISTS notice_version VARCHAR(32) NULL COMMENT 'Privacy notice version in effect at submission',
  ADD COLUMN IF NOT EXISTS data_categories JSON NULL COMMENT 'Data categories the principal wants restricted',
  ADD COLUMN IF NOT EXISTS implementation_completed_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS closed_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS final_decision_by CHAR(36) NULL,
  ADD COLUMN IF NOT EXISTS sla_due_at DATETIME NULL COMMENT 'DPDP Act §13 — 72h SLA deadline',
  ADD COLUMN IF NOT EXISTS assigned_to CHAR(36) NULL COMMENT 'HR/DPO user assigned for review';

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

ALTER TABLE dpdp_withdrawal_audit_log
  ADD COLUMN IF NOT EXISTS from_status VARCHAR(40) NULL,
  ADD COLUMN IF NOT EXISTS to_status VARCHAR(40) NULL,
  ADD COLUMN IF NOT EXISTS actor_role VARCHAR(50) NULL,
  ADD COLUMN IF NOT EXISTS ip_address VARCHAR(64) NULL;

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

ALTER TABLE dpdp_processing_hold
  ADD COLUMN IF NOT EXISTS entity_type VARCHAR(50) NULL DEFAULT 'employee' COMMENT 'Type of entity under hold',
  ADD COLUMN IF NOT EXISTS entity_id VARCHAR(36) NULL COMMENT 'ID of entity under hold (employee_id, candidate_id etc)';
