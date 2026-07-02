-- Migration 295: Candidate Name Consistency Matrix
-- Creates: candidate_name_match_summary, candidate_name_match_detail, candidate_name_override_audit
-- Safe to re-run: CREATE TABLE IF NOT EXISTS, INSERT IGNORE

CREATE TABLE IF NOT EXISTS candidate_name_match_summary (
  id                   CHAR(36)    NOT NULL,
  candidate_id         CHAR(36)    NOT NULL,
  overall_status       VARCHAR(30) NOT NULL DEFAULT 'pending' COMMENT 'matched/mismatch/partial/pending',
  mismatch_sources     JSON        DEFAULT NULL,
  last_calculated_at   DATETIME    DEFAULT NULL,
  is_override_approved TINYINT(1)  NOT NULL DEFAULT 0,
  override_reason      TEXT        DEFAULT NULL,
  override_by          CHAR(36)    DEFAULT NULL,
  override_at          DATETIME    DEFAULT NULL,
  blocks_employee_code TINYINT(1)  NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_candidate (candidate_id),
  INDEX idx_candidate (candidate_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS candidate_name_match_detail (
  id              CHAR(36)      NOT NULL,
  candidate_id    CHAR(36)      NOT NULL,
  source_type     VARCHAR(50)   NOT NULL COMMENT 'form/aadhaar/pan/bank/epfo/education/appointment_letter/employee_master',
  source_name     VARCHAR(500)  DEFAULT NULL,
  normalized_name VARCHAR(500)  DEFAULT NULL,
  match_score     DECIMAL(5,2)  DEFAULT NULL,
  is_match        TINYINT(1)    DEFAULT NULL,
  notes           TEXT          DEFAULT NULL,
  checked_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_candidate_source (candidate_id, source_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS candidate_name_override_audit (
  id               CHAR(36)    NOT NULL,
  candidate_id     CHAR(36)    NOT NULL,
  override_type    VARCHAR(30) NOT NULL,
  reason           TEXT        DEFAULT NULL,
  approved_by      CHAR(36)    DEFAULT NULL,
  approved_at      DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  previous_status  VARCHAR(30) DEFAULT NULL,
  new_status       VARCHAR(30) DEFAULT NULL,
  PRIMARY KEY (id),
  INDEX idx_candidate (candidate_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Register page code
INSERT IGNORE INTO page_catalog (id, page_code, page_name, module, description, active_status)
VALUES (UUID(), 'NAME_CONSISTENCY_MATRIX', 'Name Consistency Matrix', 'ats', 'Candidate name cross-source validation', 1);

-- Grant super_admin
INSERT IGNORE INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), 'super_admin', page_code, 1, 1, 1, 1, 1, 1
FROM page_catalog WHERE page_code = 'NAME_CONSISTENCY_MATRIX';
