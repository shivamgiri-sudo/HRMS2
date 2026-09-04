-- Migration 289: Candidate Onboarding Full Field Parity
-- Adds missing columns identified in CANDIDATE_ONBOARD_FULL_GAP_REPORT.md

-- ── candidate_onboarding_profile additions ────────────────────────────────────
SET @mcol_1 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_onboarding_profile' AND COLUMN_NAME = 'mother_name'
);
SET @msql_1 = IF(@mcol_1 = 0,
  'ALTER TABLE candidate_onboarding_profile ADD COLUMN mother_name                  VARCHAR(255)  NULL AFTER father_husband_name',
  'SELECT "mother_name already exists" AS message');
PREPARE mstmt_1 FROM @msql_1;
EXECUTE mstmt_1;
DEALLOCATE PREPARE mstmt_1;

SET @mcol_2 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_onboarding_profile' AND COLUMN_NAME = 'emergency_contact_name'
);
SET @msql_2 = IF(@mcol_2 = 0,
  'ALTER TABLE candidate_onboarding_profile ADD COLUMN emergency_contact_name       VARCHAR(255)  NULL AFTER alt_mobile_number',
  'SELECT "emergency_contact_name already exists" AS message');
PREPARE mstmt_2 FROM @msql_2;
EXECUTE mstmt_2;
DEALLOCATE PREPARE mstmt_2;

SET @mcol_3 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_onboarding_profile' AND COLUMN_NAME = 'emergency_contact_relation'
);
SET @msql_3 = IF(@mcol_3 = 0,
  'ALTER TABLE candidate_onboarding_profile ADD COLUMN emergency_contact_relation   VARCHAR(100)  NULL AFTER emergency_contact_name',
  'SELECT "emergency_contact_relation already exists" AS message');
PREPARE mstmt_3 FROM @msql_3;
EXECUTE mstmt_3;
DEALLOCATE PREPARE mstmt_3;

SET @mcol_4 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_onboarding_profile' AND COLUMN_NAME = 'nationality'
);
SET @msql_4 = IF(@mcol_4 = 0,
  'ALTER TABLE candidate_onboarding_profile ADD COLUMN nationality                  VARCHAR(100)  NULL DEFAULT ''Indian''',
  'SELECT "nationality already exists" AS message');
PREPARE mstmt_4 FROM @msql_4;
EXECUTE mstmt_4;
DEALLOCATE PREPARE mstmt_4;

SET @mcol_5 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_onboarding_profile' AND COLUMN_NAME = 'religion'
);
SET @msql_5 = IF(@mcol_5 = 0,
  'ALTER TABLE candidate_onboarding_profile ADD COLUMN religion                     VARCHAR(100)  NULL',
  'SELECT "religion already exists" AS message');
PREPARE mstmt_5 FROM @msql_5;
EXECUTE mstmt_5;
DEALLOCATE PREPARE mstmt_5;

SET @mcol_6 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_onboarding_profile' AND COLUMN_NAME = 'category'
);
SET @msql_6 = IF(@mcol_6 = 0,
  'ALTER TABLE candidate_onboarding_profile ADD COLUMN category                     VARCHAR(100)  NULL COMMENT ''SC/ST/OBC/General/Other''',
  'SELECT "category already exists" AS message');
PREPARE mstmt_6 FROM @msql_6;
EXECUTE mstmt_6;
DEALLOCATE PREPARE mstmt_6;

SET @mcol_7 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_onboarding_profile' AND COLUMN_NAME = 'present_state_id'
);
SET @msql_7 = IF(@mcol_7 = 0,
  'ALTER TABLE candidate_onboarding_profile ADD COLUMN present_state_id             CHAR(36)      NULL',
  'SELECT "present_state_id already exists" AS message');
PREPARE mstmt_7 FROM @msql_7;
EXECUTE mstmt_7;
DEALLOCATE PREPARE mstmt_7;

SET @mcol_8 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_onboarding_profile' AND COLUMN_NAME = 'permanent_state_id'
);
SET @msql_8 = IF(@mcol_8 = 0,
  'ALTER TABLE candidate_onboarding_profile ADD COLUMN permanent_state_id           CHAR(36)      NULL',
  'SELECT "permanent_state_id already exists" AS message');
PREPARE mstmt_8 FROM @msql_8;
EXECUTE mstmt_8;
DEALLOCATE PREPARE mstmt_8;

SET @mcol_9 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_onboarding_profile' AND COLUMN_NAME = 'address_proof_type'
);
SET @msql_9 = IF(@mcol_9 = 0,
  'ALTER TABLE candidate_onboarding_profile ADD COLUMN address_proof_type           VARCHAR(50)   NULL COMMENT ''aadhaar/driving_license/voter_id/passport/rent_agreement/utility_bill''',
  'SELECT "address_proof_type already exists" AS message');
PREPARE mstmt_9 FROM @msql_9;
EXECUTE mstmt_9;
DEALLOCATE PREPARE mstmt_9;

SET @mcol_10 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_onboarding_profile' AND COLUMN_NAME = 'eps_member'
);
SET @msql_10 = IF(@mcol_10 = 0,
  'ALTER TABLE candidate_onboarding_profile ADD COLUMN eps_member                   TINYINT(1)    NULL',
  'SELECT "eps_member already exists" AS message');
PREPARE mstmt_10 FROM @msql_10;
EXECUTE mstmt_10;
DEALLOCATE PREPARE mstmt_10;

SET @mcol_11 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_onboarding_profile' AND COLUMN_NAME = 'international_worker'
);
SET @msql_11 = IF(@mcol_11 = 0,
  'ALTER TABLE candidate_onboarding_profile ADD COLUMN international_worker         TINYINT(1)    NULL DEFAULT 0',
  'SELECT "international_worker already exists" AS message');
PREPARE mstmt_11 FROM @msql_11;
EXECUTE mstmt_11;
DEALLOCATE PREPARE mstmt_11;

SET @mcol_12 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_onboarding_profile' AND COLUMN_NAME = 'previous_pf_member'
);
SET @msql_12 = IF(@mcol_12 = 0,
  'ALTER TABLE candidate_onboarding_profile ADD COLUMN previous_pf_member           TINYINT(1)    NULL COMMENT ''1=yes 0=no''',
  'SELECT "previous_pf_member already exists" AS message');
PREPARE mstmt_12 FROM @msql_12;
EXECUTE mstmt_12;
DEALLOCATE PREPARE mstmt_12;

SET @mcol_13 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_onboarding_profile' AND COLUMN_NAME = 'statutory_declaration_accepted'
);
SET @msql_13 = IF(@mcol_13 = 0,
  'ALTER TABLE candidate_onboarding_profile ADD COLUMN statutory_declaration_accepted TINYINT(1)  NOT NULL DEFAULT 0',
  'SELECT "statutory_declaration_accepted already exists" AS message');
PREPARE mstmt_13 FROM @msql_13;
EXECUTE mstmt_13;
DEALLOCATE PREPARE mstmt_13;

SET @mcol_14 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_onboarding_profile' AND COLUMN_NAME = 'statutory_declaration_at'
);
SET @msql_14 = IF(@mcol_14 = 0,
  'ALTER TABLE candidate_onboarding_profile ADD COLUMN statutory_declaration_at     DATETIME      NULL',
  'SELECT "statutory_declaration_at already exists" AS message');
PREPARE mstmt_14 FROM @msql_14;
EXECUTE mstmt_14;
DEALLOCATE PREPARE mstmt_14;

SET @mcol_15 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_onboarding_profile' AND COLUMN_NAME = 'otp_verified'
);
SET @msql_15 = IF(@mcol_15 = 0,
  'ALTER TABLE candidate_onboarding_profile ADD COLUMN otp_verified                 TINYINT(1)    NOT NULL DEFAULT 0',
  'SELECT "otp_verified already exists" AS message');
PREPARE mstmt_15 FROM @msql_15;
EXECUTE mstmt_15;
DEALLOCATE PREPARE mstmt_15;

SET @mcol_16 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_onboarding_profile' AND COLUMN_NAME = 'otp_verified_at'
);
SET @msql_16 = IF(@mcol_16 = 0,
  'ALTER TABLE candidate_onboarding_profile ADD COLUMN otp_verified_at              DATETIME      NULL',
  'SELECT "otp_verified_at already exists" AS message');
PREPARE mstmt_16 FROM @msql_16;
EXECUTE mstmt_16;
DEALLOCATE PREPARE mstmt_16;

SET @mcol_17 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_onboarding_profile' AND COLUMN_NAME = 'otp_mobile'
);
SET @msql_17 = IF(@mcol_17 = 0,
  'ALTER TABLE candidate_onboarding_profile ADD COLUMN otp_mobile                   VARCHAR(20)   NULL COMMENT ''Mobile used for OTP''',
  'SELECT "otp_mobile already exists" AS message');
PREPARE mstmt_17 FROM @msql_17;
EXECUTE mstmt_17;
DEALLOCATE PREPARE mstmt_17;

-- ── candidate_onboarding_experience additions ─────────────────────────────────
SET @mcol_18 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_onboarding_experience' AND COLUMN_NAME = 'from_date'
);
SET @msql_18 = IF(@mcol_18 = 0,
  'ALTER TABLE candidate_onboarding_experience ADD COLUMN from_date         DATE          NULL AFTER employer_name',
  'SELECT "from_date already exists" AS message');
PREPARE mstmt_18 FROM @msql_18;
EXECUTE mstmt_18;
DEALLOCATE PREPARE mstmt_18;

SET @mcol_19 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_onboarding_experience' AND COLUMN_NAME = 'to_date'
);
SET @msql_19 = IF(@mcol_19 = 0,
  'ALTER TABLE candidate_onboarding_experience ADD COLUMN to_date           DATE          NULL AFTER from_date',
  'SELECT "to_date already exists" AS message');
PREPARE mstmt_19 FROM @msql_19;
EXECUTE mstmt_19;
DEALLOCATE PREPARE mstmt_19;

SET @mcol_20 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_onboarding_experience' AND COLUMN_NAME = 'reason_for_leaving'
);
SET @msql_20 = IF(@mcol_20 = 0,
  'ALTER TABLE candidate_onboarding_experience ADD COLUMN reason_for_leaving VARCHAR(500) NULL',
  'SELECT "reason_for_leaving already exists" AS message');
PREPARE mstmt_20 FROM @msql_20;
EXECUTE mstmt_20;
DEALLOCATE PREPARE mstmt_20;

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
