-- Migration 293: DPDP Consent Withdrawal Workflow
-- Creates: dpdp_consent_withdrawal, dpdp_withdrawal_audit_log, dpdp_processing_hold
-- Safe to re-run: CREATE TABLE IF NOT EXISTS, INSERT IGNORE

CREATE TABLE IF NOT EXISTS dpdp_consent_withdrawal (
  id                     CHAR(36)    NOT NULL,
  requester_id           CHAR(36)    NOT NULL,
  requester_type         VARCHAR(20) NOT NULL DEFAULT 'employee' COMMENT 'employee/candidate',
  scope_json             JSON        DEFAULT NULL COMMENT 'which consents to withdraw',
  withdrawal_reason      TEXT        DEFAULT NULL,
  status                 VARCHAR(30) NOT NULL DEFAULT 'submitted' COMMENT 'submitted/in_review/approved/rejected/hold_released',
  reviewed_by            CHAR(36)    DEFAULT NULL,
  reviewed_at            DATETIME    DEFAULT NULL,
  review_remarks         TEXT        DEFAULT NULL,
  processing_hold_active TINYINT(1)  NOT NULL DEFAULT 0,
  hold_applied_at        DATETIME    DEFAULT NULL,
  hold_released_at       DATETIME    DEFAULT NULL,
  created_at             DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_requester (requester_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS dpdp_withdrawal_audit_log (
  id            CHAR(36)    NOT NULL,
  withdrawal_id CHAR(36)    NOT NULL,
  action        VARCHAR(50) NOT NULL,
  from_status   VARCHAR(30) DEFAULT NULL,
  to_status     VARCHAR(30) DEFAULT NULL,
  remarks       TEXT        DEFAULT NULL,
  performed_by  CHAR(36)    DEFAULT NULL,
  performed_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_withdrawal (withdrawal_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS dpdp_processing_hold (
  id           CHAR(36)    NOT NULL,
  withdrawal_id CHAR(36)   NOT NULL,
  entity_type  VARCHAR(50) NOT NULL,
  entity_id    CHAR(36)    NOT NULL,
  hold_reason  TEXT        DEFAULT NULL,
  is_active    TINYINT(1)  NOT NULL DEFAULT 1,
  applied_at   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  released_at  DATETIME    DEFAULT NULL,
  released_by  CHAR(36)    DEFAULT NULL,
  PRIMARY KEY (id),
  INDEX idx_entity (entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Register page codes
INSERT IGNORE INTO page_catalog (id, page_code, page_name, module, description, active_status)
VALUES
  (UUID(), 'DPDP_WITHDRAWAL',       'DPDP Withdrawal Request', 'compliance', 'Submit/view DPDP consent withdrawal', 1),
  (UUID(), 'DPDP_WITHDRAWAL_ADMIN', 'DPDP Withdrawal Admin',   'compliance', 'Review and process withdrawal requests', 1);

-- Grant super_admin
INSERT IGNORE INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), 'super_admin', page_code, 1, 1, 1, 1, 1, 1
FROM page_catalog WHERE page_code IN ('DPDP_WITHDRAWAL','DPDP_WITHDRAWAL_ADMIN');
