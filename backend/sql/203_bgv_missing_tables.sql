-- Migration 203: Create BGV tables missing from all prior migrations
-- candidate_bgv_consent, candidate_bgv_check, candidate_digilocker_session
-- were referenced in bgv-verification.service.ts but never defined in SQL.
-- Also adds passport_number / dl_number aliases for V2 onboarding form.

-- ── 1. candidate_bgv_consent ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS candidate_bgv_consent (
  id                  CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id        CHAR(36)     NOT NULL,
  consent_version     VARCHAR(50)  NOT NULL DEFAULT 'BGV-DPDP-v1',
  consent_text_hash   CHAR(64)     NULL     COMMENT 'SHA-256 of the consent text shown to candidate',
  purpose_json        JSON         NULL     COMMENT 'Array of purpose strings e.g. ["bgv","employment"]',
  consent_status      ENUM('granted','withdrawn') NOT NULL DEFAULT 'granted',
  ip_address          VARCHAR(64)  NULL,
  user_agent          VARCHAR(512) NULL,
  granted_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  withdrawn_at        DATETIME     NULL,
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_bgv_consent_candidate (candidate_id),
  INDEX idx_bgv_consent_status    (candidate_id, consent_status)
);

-- ── 2. candidate_bgv_check ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS candidate_bgv_check (
  id                    CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id          CHAR(36)     NOT NULL,
  check_type            ENUM('pan','aadhaar','aadhaar_offline','bank','digilocker',
                             'employment','education','address','criminal',
                             'court','address_doc','education_doc','photo_match')
                                     NOT NULL,
  source_document_id    CHAR(36)     NULL     COMMENT 'candidate_onboarding_document.id that triggered this check',
  provider_key          VARCHAR(80)  NULL     COMMENT 'e.g. mock_bgv, infiniti_ai, digio',
  provider_request_id   VARCHAR(200) NULL,
  provider_reference_id VARCHAR(200) NULL,
  status                ENUM('pending','in_progress','verified','mismatch','failed','manual_review','waived','queued')
                                     NOT NULL DEFAULT 'pending',
  match_score           TINYINT UNSIGNED NULL COMMENT '0-100 name/DOB match score from provider',
  matched_name          VARCHAR(255) NULL,
  matched_dob           DATE         NULL,
  result_summary        TEXT         NULL,
  result_json           JSON         NULL     COMMENT 'Full provider API response',
  risk_flags_json       JSON         NULL,
  review_remarks        TEXT         NULL,
  reviewed_by           CHAR(36)     NULL,
  reviewed_at           DATETIME     NULL,
  verified_at           DATETIME     NULL,
  created_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_bgv_check_candidate  (candidate_id),
  INDEX idx_bgv_check_type       (candidate_id, check_type),
  INDEX idx_bgv_check_provider   (provider_request_id),
  INDEX idx_bgv_check_status     (status)
);

-- ── 3. candidate_digilocker_session ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS candidate_digilocker_session (
  id                        CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id              CHAR(36)     NOT NULL,
  state_token               VARCHAR(200) NOT NULL COMMENT 'OAuth state parameter',
  provider_key              VARCHAR(80)  NOT NULL DEFAULT 'mock_digilocker',
  auth_url                  VARCHAR(1000) NOT NULL,
  session_status            ENUM('created','completed','failed','expired') NOT NULL DEFAULT 'created',
  requested_documents_json  JSON         NULL,
  fetched_documents_json    JSON         NULL,
  expires_at                DATETIME     NULL,
  completed_at              DATETIME     NULL,
  created_at                DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_digilocker_candidate (candidate_id),
  INDEX idx_digilocker_state     (state_token)
);

-- ── 4. Add passport_number / dl_number aliases for V2 onboarding form ─────────
-- V2 frontend (S3_KYCDocuments) sends passport_number and dl_number.
-- The original columns passport_no / driving_license_no exist from migration 200.
-- Add the V2 column names as separate columns so both form versions work.
DELIMITER //
CREATE PROCEDURE _m203_profile_v2_aliases()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'candidate_onboarding_profile'
      AND COLUMN_NAME = 'passport_number'
  ) THEN
    ALTER TABLE candidate_onboarding_profile
      ADD COLUMN passport_number VARCHAR(50) NULL COMMENT 'Passport number (V2 form alias for passport_no)',
      ADD COLUMN dl_number       VARCHAR(50) NULL COMMENT 'Driving licence number (V2 form alias for driving_license_no)';
  END IF;
END//
DELIMITER ;
CALL _m203_profile_v2_aliases();
DROP PROCEDURE IF EXISTS _m203_profile_v2_aliases;

SELECT '203_bgv_missing_tables.sql applied successfully' AS migration_status;
