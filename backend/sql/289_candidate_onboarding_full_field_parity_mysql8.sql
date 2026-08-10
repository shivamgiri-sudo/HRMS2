-- Migration 289: Candidate Onboarding Full Field Parity (MySQL 8.0 compatible)
-- Uses procedure to safely add columns only if they don't already exist

DROP PROCEDURE IF EXISTS _289_add_col;
DELIMITER $$
CREATE PROCEDURE _289_add_col(
  IN tbl VARCHAR(64),
  IN col VARCHAR(64),
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

-- ── candidate_onboarding_profile additions ────────────────────────────────────
CALL _289_add_col('candidate_onboarding_profile', 'mother_name',                  "VARCHAR(255) NULL AFTER father_husband_name");
CALL _289_add_col('candidate_onboarding_profile', 'emergency_contact_name',       "VARCHAR(255) NULL AFTER alt_mobile_number");
CALL _289_add_col('candidate_onboarding_profile', 'emergency_contact_relation',   "VARCHAR(100) NULL AFTER emergency_contact_name");
CALL _289_add_col('candidate_onboarding_profile', 'emergency_contact_mobile',     "VARCHAR(20) NULL AFTER emergency_contact_relation");
CALL _289_add_col('candidate_onboarding_profile', 'nationality',                  "VARCHAR(100) NULL DEFAULT 'Indian'");
CALL _289_add_col('candidate_onboarding_profile', 'religion',                     "VARCHAR(100) NULL");
CALL _289_add_col('candidate_onboarding_profile', 'category',                     "VARCHAR(100) NULL COMMENT 'SC/ST/OBC/General/Other'");
CALL _289_add_col('candidate_onboarding_profile', 'present_state_id',             "CHAR(36) NULL");
CALL _289_add_col('candidate_onboarding_profile', 'permanent_state_id',           "CHAR(36) NULL");
CALL _289_add_col('candidate_onboarding_profile', 'address_proof_type',           "VARCHAR(50) NULL COMMENT 'aadhaar/driving_license/voter_id/passport/rent_agreement/utility_bill'");
CALL _289_add_col('candidate_onboarding_profile', 'eps_member',                   "TINYINT(1) NULL");
CALL _289_add_col('candidate_onboarding_profile', 'international_worker',         "TINYINT(1) NULL DEFAULT 0");
CALL _289_add_col('candidate_onboarding_profile', 'previous_pf_member',           "TINYINT(1) NULL COMMENT '1=yes 0=no'");
CALL _289_add_col('candidate_onboarding_profile', 'statutory_declaration_accepted',"TINYINT(1) NOT NULL DEFAULT 0");
CALL _289_add_col('candidate_onboarding_profile', 'statutory_declaration_at',     "DATETIME NULL");
CALL _289_add_col('candidate_onboarding_profile', 'otp_verified',                 "TINYINT(1) NOT NULL DEFAULT 0");
CALL _289_add_col('candidate_onboarding_profile', 'otp_verified_at',              "DATETIME NULL");
CALL _289_add_col('candidate_onboarding_profile', 'otp_mobile',                   "VARCHAR(20) NULL COMMENT 'Mobile used for OTP'");

-- ── candidate_onboarding_experience additions ─────────────────────────────────
CALL _289_add_col('candidate_onboarding_experience', 'from_date',          "DATE NULL AFTER employer_name");
CALL _289_add_col('candidate_onboarding_experience', 'to_date',            "DATE NULL AFTER from_date");
CALL _289_add_col('candidate_onboarding_experience', 'reason_for_leaving', "VARCHAR(500) NULL");

-- ── candidate_onboarding_otp ─────────────────────────────────────────────────
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

-- ── candidate_onboarding_language ────────────────────────────────────────────
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

-- ── candidate_onboarding_autosave ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS candidate_onboarding_autosave (
  id              CHAR(36)      NOT NULL PRIMARY KEY,
  candidate_id    CHAR(36)      NOT NULL,
  section         VARCHAR(50)   NOT NULL,
  data_json       MEDIUMTEXT    NOT NULL,
  saved_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_candidate_section (candidate_id, section)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

DROP PROCEDURE IF EXISTS _289_add_col;
