-- Job requisition deadline automation.
--   job_requisition_alert_log        one row per (requisition, alert type, stage) so a restart or a
--                                    second scheduler process never sends the same alert twice.
--   job_requisition_expiry_decision  a partly filled requisition past its validity is NOT closed by
--                                    the system; HR decides (close / extend / keep open). One row per
--                                    expiry cycle, kept as the audit trail of that decision.
-- Collation matches job_requisition (utf8mb4_unicode_ci). Additive and idempotent.

CREATE TABLE IF NOT EXISTS job_requisition_alert_log (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  requisition_id CHAR(36) NOT NULL,
  alert_type VARCHAR(40) NOT NULL,
  stage_key VARCHAR(40) NOT NULL,
  recipient_count INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_jr_alert (requisition_id, alert_type, stage_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS job_requisition_expiry_decision (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  requisition_id CHAR(36) NOT NULL,
  cycle_no INT NOT NULL DEFAULT 1,
  status ENUM('pending','closed','extended','kept_open') NOT NULL DEFAULT 'pending',
  validity_at_detection DATE NULL,
  requested_headcount INT NOT NULL DEFAULT 0,
  fulfilled_at_detection INT NOT NULL DEFAULT 0,
  decided_by CHAR(36) NULL,
  decided_by_name VARCHAR(255) NULL,
  decided_at DATETIME NULL,
  reason TEXT NULL,
  new_validity DATE NULL,
  review_after DATE NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_jr_expiry_cycle (requisition_id, cycle_no),
  KEY idx_jr_expiry_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
