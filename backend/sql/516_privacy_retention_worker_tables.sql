-- Migration 516: Privacy Retention Worker Tables
-- Supports the dry-run retention engine in backend/src/workers/privacy-retention.worker.ts
-- Default mode is dry_run — no records are deleted without an explicit approval record.

-- ── 1. Retention runs ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS privacy_retention_run (
  id          CHAR(36)     NOT NULL DEFAULT (UUID()),
  run_mode    ENUM('dry_run','approved_actions') NOT NULL DEFAULT 'dry_run',
  status      ENUM('started','completed','failed') NOT NULL DEFAULT 'started',
  started_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME    NULL,
  triggered_by VARCHAR(36) NULL COMMENT 'auth_user.id or "cron"',
  candidate_count INT      NOT NULL DEFAULT 0 COMMENT 'Records identified for disposal',
  actioned_count  INT      NOT NULL DEFAULT 0 COMMENT 'Records actually anonymized/deleted',
  error_summary TEXT       NULL,
  PRIMARY KEY (id),
  KEY idx_prr_started (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 2. Retention candidates ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS privacy_retention_candidate (
  id                  CHAR(36)    NOT NULL DEFAULT (UUID()),
  run_id              CHAR(36)    NOT NULL,
  policy_id           CHAR(36)    NULL COMMENT 'References data_retention_policy.id',
  entity_type         VARCHAR(64) NOT NULL COMMENT 'e.g. employee, ats_candidate, data_consent',
  entity_id           CHAR(36)    NOT NULL,
  table_name          VARCHAR(100) NOT NULL,
  record_date         DATE        NULL COMMENT 'The date used to evaluate retention (e.g. exit_date)',
  retention_days      INT         NOT NULL,
  disposal_action     ENUM('anonymize','delete','archive') NOT NULL DEFAULT 'anonymize',
  has_legal_hold      TINYINT(1)  NOT NULL DEFAULT 0,
  has_processing_hold TINYINT(1)  NOT NULL DEFAULT 0,
  eligible_for_action TINYINT(1)  NOT NULL DEFAULT 0 COMMENT '1 = no holds, past retention period',
  actioned_at         DATETIME    NULL,
  action_result       ENUM('skipped','anonymized','deleted','archived','error') NULL,
  error_details       TEXT        NULL,
  created_at          DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_prc_run (run_id),
  KEY idx_prc_entity (entity_type, entity_id),
  KEY idx_prc_eligible (eligible_for_action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 3. Retention approvals (DPO must create one before actions execute) ──────

CREATE TABLE IF NOT EXISTS privacy_retention_approval (
  id          CHAR(36)    NOT NULL DEFAULT (UUID()),
  run_id      CHAR(36)    NOT NULL COMMENT 'References privacy_retention_run.id',
  approved_by CHAR(36)    NOT NULL COMMENT 'auth_user.id (must be dpo or admin)',
  approved_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes       TEXT        NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pra_run (run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 4. Disposal certificates ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS privacy_disposal_certificate (
  id             CHAR(36)    NOT NULL DEFAULT (UUID()),
  run_id         CHAR(36)    NOT NULL,
  entity_type    VARCHAR(64) NOT NULL,
  records_count  INT         NOT NULL DEFAULT 0,
  disposal_type  ENUM('anonymize','delete','archive') NOT NULL,
  certificate_hash VARCHAR(64) NULL COMMENT 'SHA-256 of disposal manifest JSON for tamper-evidence',
  issued_at      DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  issued_by      VARCHAR(36) NULL COMMENT 'System identifier or triggering user id',
  PRIMARY KEY (id),
  KEY idx_pdc_run (run_id),
  KEY idx_pdc_entity (entity_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
