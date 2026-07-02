-- Migration 298: Candidate Onboarding Full Final Fix
-- MySQL 8.0 compatible, safe re-run, uses stored procedure for column adds
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. candidate_onboarding_section_status ───────────────────────────────────
CREATE TABLE IF NOT EXISTS candidate_onboarding_section_status (
  id           CHAR(36)      NOT NULL PRIMARY KEY,
  candidate_id CHAR(36)      NOT NULL,
  section      VARCHAR(50)   NOT NULL,
  is_complete  TINYINT(1)    NOT NULL DEFAULT 0,
  completed_at DATETIME      NULL,
  last_updated DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_candidate_section (candidate_id, section)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 2. candidate_onboarding_audit_log ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS candidate_onboarding_audit_log (
  id           CHAR(36)      NOT NULL PRIMARY KEY,
  candidate_id CHAR(36)      NOT NULL,
  action       VARCHAR(100)  NOT NULL,
  section      VARCHAR(50)   NULL,
  remarks      TEXT          NULL,
  performed_by VARCHAR(255)  NULL,
  ip_address   VARCHAR(45)   NULL,
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_candidate (candidate_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 3. candidate_onboarding_profile column additions (stored procedure) ──────
DROP PROCEDURE IF EXISTS _298_add_col;
DELIMITER $$
CREATE PROCEDURE _298_add_col(
  IN tbl     VARCHAR(64),
  IN col     VARCHAR(64),
  IN col_def TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = tbl AND COLUMN_NAME = col
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `', tbl, '` ADD COLUMN `', col, '` ', col_def);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$
DELIMITER ;

CALL _298_add_col('candidate_onboarding_profile', 'guardian_name',             "VARCHAR(255) NULL");
CALL _298_add_col('candidate_onboarding_profile', 'present_address_line1',     "VARCHAR(500) NULL");
CALL _298_add_col('candidate_onboarding_profile', 'present_address_line2',     "VARCHAR(500) NULL");
CALL _298_add_col('candidate_onboarding_profile', 'present_city',              "VARCHAR(100) NULL");
CALL _298_add_col('candidate_onboarding_profile', 'present_pincode',           "VARCHAR(10) NULL");
CALL _298_add_col('candidate_onboarding_profile', 'permanent_address_line1',   "VARCHAR(500) NULL");
CALL _298_add_col('candidate_onboarding_profile', 'permanent_address_line2',   "VARCHAR(500) NULL");
CALL _298_add_col('candidate_onboarding_profile', 'permanent_city',            "VARCHAR(100) NULL");
CALL _298_add_col('candidate_onboarding_profile', 'permanent_pincode',         "VARCHAR(10) NULL");
CALL _298_add_col('candidate_onboarding_profile', 'bank_branch_name',          "VARCHAR(255) NULL");
CALL _298_add_col('candidate_onboarding_profile', 'uan',                       "VARCHAR(20) NULL");
CALL _298_add_col('candidate_onboarding_profile', 'esic_number',               "VARCHAR(20) NULL");
CALL _298_add_col('candidate_onboarding_profile', 'section_completion_json',   "JSON NULL COMMENT 'JSON map of section to completion status'");
CALL _298_add_col('candidate_onboarding_profile', 'dpdp_consent',              "TINYINT(1) NOT NULL DEFAULT 0");
CALL _298_add_col('candidate_onboarding_profile', 'dpdp_consent_at',           "DATETIME NULL");
CALL _298_add_col('candidate_onboarding_profile', 'bgv_consent',               "TINYINT(1) NOT NULL DEFAULT 0");
CALL _298_add_col('candidate_onboarding_profile', 'bgv_consent_at',            "DATETIME NULL");
CALL _298_add_col('candidate_onboarding_profile', 'submit_blocked_reason',     "TEXT NULL");

DROP PROCEDURE IF EXISTS _298_add_col;

-- ── 4. candidate_onboarding_nominee ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS candidate_onboarding_nominee (
  id               CHAR(36)        NOT NULL PRIMARY KEY,
  candidate_id     CHAR(36)        NOT NULL,
  nominee_name     VARCHAR(255)    NULL,
  relation         VARCHAR(100)    NULL,
  dob              DATE            NULL,
  share_percentage DECIMAL(5,2)    NULL,
  address          TEXT            NULL,
  aadhar_last4     CHAR(4)         NULL,
  is_primary       TINYINT(1)      NOT NULL DEFAULT 0,
  created_at       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_candidate (candidate_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 5. candidate_onboarding_family (members) ─────────────────────────────────
-- Note: existing candidate_onboarding_family table stores aggregate family data
-- (annual_income, count_of_dependents). This new table stores individual members.
CREATE TABLE IF NOT EXISTS candidate_onboarding_family_member (
  id           CHAR(36)      NOT NULL PRIMARY KEY,
  candidate_id CHAR(36)      NOT NULL,
  member_name  VARCHAR(255)  NULL,
  relation     VARCHAR(100)  NULL,
  dob          DATE          NULL,
  occupation   VARCHAR(100)  NULL,
  is_dependent TINYINT(1)    NOT NULL DEFAULT 0,
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_candidate (candidate_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 6. page_catalog entries for onboarding pages ─────────────────────────────
INSERT IGNORE INTO page_catalog (id, page_code, page_name, page_path, module, description)
VALUES
  (UUID(), 'CANDIDATE_ONBOARDING_FULL',    'Candidate Onboarding (Full)',        '/candidate-onboarding', 'ATS',        'Full 10-step candidate onboarding form (candidate-facing)'),
  (UUID(), 'ONBOARDING_REQUESTS',          'Onboarding Requests',                '/ats/onboarding',       'ATS',        'HR view of all candidate onboarding submissions'),
  (UUID(), 'ONBOARDING_REVIEW',            'Onboarding Review',                  '/ats/onboarding/:id',   'ATS',        'HR review and approval of individual onboarding submission'),
  (UUID(), 'ONBOARDING_BGV',               'Onboarding BGV Dashboard',           '/ats/bgv',              'ATS',        'Background verification status across onboarding candidates'),
  (UUID(), 'ONBOARDING_SECTION_STATUS',    'Onboarding Section Status',          '/ats/onboarding/sections', 'ATS',     'Per-section completion status for candidate onboarding');
