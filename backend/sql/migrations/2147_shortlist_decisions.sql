-- 2147: Selection criteria (plan 2026-10-09, S10-S13). The shortlist decision tables the amended WS3 2143 described, built here first
-- (WS3 must drop them from 2143): a run per requisition x source with its criteria version, one decision row per person who was picked,
-- put in review, overridden, approved, enrolled or HR-rejected (plain fails stay counts in counts_json), HR include/exclude overrides
-- with a mandatory reason and an append-only log, and HR approvals (one batch per run, or a standing approval for Live Meta).
-- Facts and decisions only: criteria values live on job_requisition. Re-runnable (CREATE TABLE IF NOT EXISTS), no foreign keys.
CREATE TABLE IF NOT EXISTS shortlist_run (
  id CHAR(36) NOT NULL PRIMARY KEY,
  requisition_id CHAR(36) NOT NULL,
  source_kind VARCHAR(12) NOT NULL,
  criteria_version_id CHAR(36) NULL,
  criteria_hash CHAR(64) NOT NULL,
  engine_version SMALLINT NOT NULL,
  counts_json JSON NOT NULL COMMENT 'start, system, per-step failed/review, outcome',
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_slr_req (requisition_id, source_kind, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shortlist_candidate (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  run_id CHAR(36) NOT NULL,
  requisition_id CHAR(36) NOT NULL,
  mobile10 CHAR(10) NOT NULL,
  source_kind VARCHAR(12) NOT NULL,
  sub_source VARCHAR(24) NOT NULL,
  verdict VARCHAR(8) NOT NULL COMMENT 'pass | review | fail',
  score DECIMAL(5,1) NOT NULL DEFAULT 0,
  status VARCHAR(12) NOT NULL COMMENT 'picked | review | excluded | unticked | approved | hr_rejected | enrolled',
  criteria_version_id CHAR(36) NULL,
  engine_version SMALLINT NOT NULL,
  rule_results_json JSON NOT NULL,
  review_json JSON NULL,
  override_kind VARCHAR(8) NULL,
  facts_hash CHAR(64) NOT NULL,
  approval_id CHAR(36) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_slc_run_person (run_id, mobile10),
  KEY idx_slc_req_person (requisition_id, mobile10)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shortlist_override (
  mobile10 CHAR(10) NOT NULL,
  requisition_scope VARCHAR(36) NOT NULL COMMENT 'a requisition id, or * for every requisition',
  kind VARCHAR(8) NOT NULL COMMENT 'include | exclude',
  reason VARCHAR(300) NOT NULL,
  actor_id CHAR(36) NOT NULL,
  actor_role VARCHAR(40) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (mobile10, requisition_scope)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shortlist_override_log (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  mobile10 CHAR(10) NOT NULL,
  requisition_scope VARCHAR(36) NOT NULL,
  action VARCHAR(8) NOT NULL COMMENT 'set | remove',
  before_json JSON NULL,
  after_json JSON NULL,
  reason VARCHAR(300) NOT NULL,
  actor_id CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_slol_person (mobile10, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shortlist_approval (
  id CHAR(36) NOT NULL PRIMARY KEY,
  run_id CHAR(36) NULL,
  requisition_id CHAR(36) NOT NULL,
  source_kind VARCHAR(12) NOT NULL,
  criteria_version_id CHAR(36) NULL,
  mode VARCHAR(10) NOT NULL COMMENT 'batch | standing',
  approved_by CHAR(36) NOT NULL,
  approved_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  valid_until DATETIME NULL,
  approved_count INT NOT NULL DEFAULT 0,
  unticked_json JSON NULL,
  note VARCHAR(300) NULL,
  revoked_at DATETIME NULL,
  revoked_by CHAR(36) NULL,
  KEY idx_sla_req (requisition_id, source_kind, mode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
