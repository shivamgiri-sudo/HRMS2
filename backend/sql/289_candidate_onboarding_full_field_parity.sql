-- Migration 289: Candidate Onboarding Full Field Parity
-- Adds missing columns identified in CANDIDATE_ONBOARD_FULL_GAP_REPORT.md

-- ── candidate_onboarding_profile additions ────────────────────────────────────
ALTER TABLE candidate_onboarding_profile
  ADD COLUMN IF NOT EXISTS mother_name                  VARCHAR(255)  NULL AFTER father_husband_name,
  ADD COLUMN IF NOT EXISTS emergency_contact_name       VARCHAR(255)  NULL AFTER alt_mobile_number,
  ADD COLUMN IF NOT EXISTS emergency_contact_relation   VARCHAR(100)  NULL AFTER emergency_contact_name,
  ADD COLUMN IF NOT EXISTS nationality                  VARCHAR(100)  NULL DEFAULT 'Indian',
  ADD COLUMN IF NOT EXISTS religion                     VARCHAR(100)  NULL,
  ADD COLUMN IF NOT EXISTS category                     VARCHAR(100)  NULL COMMENT 'SC/ST/OBC/General/Other',
  ADD COLUMN IF NOT EXISTS present_state_id             CHAR(36)      NULL,
  ADD COLUMN IF NOT EXISTS permanent_state_id           CHAR(36)      NULL,
  ADD COLUMN IF NOT EXISTS address_proof_type           VARCHAR(50)   NULL COMMENT 'aadhaar/driving_license/voter_id/passport/rent_agreement/utility_bill',
  ADD COLUMN IF NOT EXISTS eps_member                   TINYINT(1)    NULL,
  ADD COLUMN IF NOT EXISTS international_worker         TINYINT(1)    NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS previous_pf_member           TINYINT(1)    NULL COMMENT '1=yes 0=no',
  ADD COLUMN IF NOT EXISTS statutory_declaration_accepted TINYINT(1)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS statutory_declaration_at     DATETIME      NULL,
  ADD COLUMN IF NOT EXISTS otp_verified                 TINYINT(1)    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS otp_verified_at              DATETIME      NULL,
  ADD COLUMN IF NOT EXISTS otp_mobile                   VARCHAR(20)   NULL COMMENT 'Mobile used for OTP';

-- ── candidate_onboarding_experience additions ─────────────────────────────────
ALTER TABLE candidate_onboarding_experience
  ADD COLUMN IF NOT EXISTS from_date         DATE          NULL AFTER employer_name,
  ADD COLUMN IF NOT EXISTS to_date           DATE          NULL AFTER from_date,
  ADD COLUMN IF NOT EXISTS reason_for_leaving VARCHAR(500) NULL;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── candidate_onboarding_autosave (draft store) ───────────────────────────────
CREATE TABLE IF NOT EXISTS candidate_onboarding_autosave (
  id              CHAR(36)      NOT NULL PRIMARY KEY,
  candidate_id    CHAR(36)      NOT NULL,
  section         VARCHAR(50)   NOT NULL,
  data_json       MEDIUMTEXT    NOT NULL,
  saved_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_candidate_section (candidate_id, section)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
