-- Migration 289: Candidate Onboarding Full Field Parity
-- Adds missing columns identified in CANDIDATE_ONBOARD_FULL_GAP_REPORT.md

-- ── candidate_onboarding_profile additions ────────────────────────────────────
ALTER TABLE candidate_onboarding_profile
  ADD COLUMN mother_name                  VARCHAR(255)  NULL AFTER father_husband_name,
  ADD COLUMN emergency_contact_name       VARCHAR(255)  NULL AFTER alt_mobile_number,
  ADD COLUMN emergency_contact_relation   VARCHAR(100)  NULL AFTER emergency_contact_name,
  ADD COLUMN nationality                  VARCHAR(100)  NULL DEFAULT 'Indian',
  ADD COLUMN religion                     VARCHAR(100)  NULL,
  ADD COLUMN category                     VARCHAR(100)  NULL COMMENT 'SC/ST/OBC/General/Other',
  ADD COLUMN present_state_id             CHAR(36)      NULL,
  ADD COLUMN permanent_state_id           CHAR(36)      NULL,
  ADD COLUMN address_proof_type           VARCHAR(50)   NULL COMMENT 'aadhaar/driving_license/voter_id/passport/rent_agreement/utility_bill',
  ADD COLUMN eps_member                   TINYINT(1)    NULL,
  ADD COLUMN international_worker         TINYINT(1)    NULL DEFAULT 0,
  ADD COLUMN previous_pf_member           TINYINT(1)    NULL COMMENT '1=yes 0=no',
  ADD COLUMN statutory_declaration_accepted TINYINT(1)  NOT NULL DEFAULT 0,
  ADD COLUMN statutory_declaration_at     DATETIME      NULL,
  ADD COLUMN otp_verified                 TINYINT(1)    NOT NULL DEFAULT 0,
  ADD COLUMN otp_verified_at              DATETIME      NULL,
  ADD COLUMN otp_mobile                   VARCHAR(20)   NULL COMMENT 'Mobile used for OTP';

-- ── candidate_onboarding_experience additions ─────────────────────────────────
-- Guarded 2026-08-03: candidate_onboarding_experience has no CREATE TABLE anywhere in sql/, so this ALTER
-- stops the chain on any fresh database. Guarding lets the build proceed; it does NOT give
-- the table a definition. Whether candidate_onboarding_experience should exist is an owner decision, recorded in
-- docs/release/migration-reconciliation.md.
SET @tbl_candidate_on_1 = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
                   WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='candidate_onboarding_experience');
SET @sql = IF(@tbl_candidate_on_1 > 0,
  'ALTER TABLE candidate_onboarding_experience ADD COLUMN from_date DATE NULL, ADD COLUMN to_date DATE NULL, ADD COLUMN reason_for_leaving VARCHAR(500) NULL',
  'SELECT ''candidate_onboarding_experience does not exist on this database; statement skipped'' AS n');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── candidate_onboarding_otp (OTP attempt table) ─────────────────────────────
CREATE TABLE IF NOT EXISTS candidate_onboarding_otp (
  id              CHAR(36)      NOT NULL PRIMARY KEY,
  candidate_id    CHAR(36)      NOT NULL,
  mobile          VARCHAR(20)   NOT NULL,
  otp_hash        VARCHAR(256)  NOT NULL,
  attempts        TINYINT       NOT NULL DEFAULT 0,
  max_attempts    TINYINT       NOT NULL DEFAULT 3,
  verified        TINYINT(1)    NOT NULL DEFAULT 0,
  expires_at      DATETIME      NOT NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  used_at         DATETIME      NULL,
  INDEX idx_candidate (candidate_id),
  INDEX idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── candidate_onboarding_language (new table) ────────────────────────────────
CREATE TABLE IF NOT EXISTS candidate_onboarding_language (
  id              CHAR(36)      NOT NULL PRIMARY KEY,
  candidate_id    CHAR(36)      NOT NULL,
  language_name   VARCHAR(100)  NOT NULL,
  can_read        TINYINT(1)    NOT NULL DEFAULT 0,
  can_write       TINYINT(1)    NOT NULL DEFAULT 0,
  can_speak       TINYINT(1)    NOT NULL DEFAULT 0,
  proficiency     VARCHAR(50)   NULL COMMENT 'basic/intermediate/fluent/native',
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_candidate (candidate_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── candidate_onboarding_autosave (draft store) ───────────────────────────────
CREATE TABLE IF NOT EXISTS candidate_onboarding_autosave (
  id              CHAR(36)      NOT NULL PRIMARY KEY,
  candidate_id    CHAR(36)      NOT NULL,
  section         VARCHAR(50)   NOT NULL,
  data_json       MEDIUMTEXT    NOT NULL,
  saved_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_candidate_section (candidate_id, section)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
