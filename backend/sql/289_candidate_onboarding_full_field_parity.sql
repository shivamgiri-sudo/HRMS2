-- Migration 289: Candidate Onboarding Full Field Parity
-- Adds missing columns identified in CANDIDATE_ONBOARD_FULL_GAP_REPORT.md
-- Rewritten as PREPARE/EXECUTE guards so the CI MySQL8 normalizer cannot strip
-- the IF NOT EXISTS checks (migration 373 already creates some of these columns).

-- ── candidate_onboarding_profile additions ────────────────────────────────────
SET @t = 'candidate_onboarding_profile';

SET @c = 'mother_name';
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=@t AND COLUMN_NAME=@c)=0, CONCAT('ALTER TABLE `',@t,'` ADD COLUMN `',@c,'` VARCHAR(255) NULL'), 'SELECT 1');
PREPARE _289 FROM @s; EXECUTE _289; DEALLOCATE PREPARE _289;

SET @c = 'emergency_contact_name';
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=@t AND COLUMN_NAME=@c)=0, CONCAT('ALTER TABLE `',@t,'` ADD COLUMN `',@c,'` VARCHAR(255) NULL'), 'SELECT 1');
PREPARE _289 FROM @s; EXECUTE _289; DEALLOCATE PREPARE _289;

SET @c = 'emergency_contact_relation';
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=@t AND COLUMN_NAME=@c)=0, CONCAT('ALTER TABLE `',@t,'` ADD COLUMN `',@c,'` VARCHAR(100) NULL'), 'SELECT 1');
PREPARE _289 FROM @s; EXECUTE _289; DEALLOCATE PREPARE _289;

SET @c = 'nationality';
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=@t AND COLUMN_NAME=@c)=0, CONCAT('ALTER TABLE `',@t,'` ADD COLUMN `',@c,'` VARCHAR(100) NULL DEFAULT ''Indian'''), 'SELECT 1');
PREPARE _289 FROM @s; EXECUTE _289; DEALLOCATE PREPARE _289;

SET @c = 'religion';
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=@t AND COLUMN_NAME=@c)=0, CONCAT('ALTER TABLE `',@t,'` ADD COLUMN `',@c,'` VARCHAR(100) NULL'), 'SELECT 1');
PREPARE _289 FROM @s; EXECUTE _289; DEALLOCATE PREPARE _289;

SET @c = 'category';
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=@t AND COLUMN_NAME=@c)=0, CONCAT('ALTER TABLE `',@t,'` ADD COLUMN `',@c,'` VARCHAR(100) NULL'), 'SELECT 1');
PREPARE _289 FROM @s; EXECUTE _289; DEALLOCATE PREPARE _289;

SET @c = 'present_state_id';
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=@t AND COLUMN_NAME=@c)=0, CONCAT('ALTER TABLE `',@t,'` ADD COLUMN `',@c,'` CHAR(36) NULL'), 'SELECT 1');
PREPARE _289 FROM @s; EXECUTE _289; DEALLOCATE PREPARE _289;

SET @c = 'permanent_state_id';
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=@t AND COLUMN_NAME=@c)=0, CONCAT('ALTER TABLE `',@t,'` ADD COLUMN `',@c,'` CHAR(36) NULL'), 'SELECT 1');
PREPARE _289 FROM @s; EXECUTE _289; DEALLOCATE PREPARE _289;

SET @c = 'address_proof_type';
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=@t AND COLUMN_NAME=@c)=0, CONCAT('ALTER TABLE `',@t,'` ADD COLUMN `',@c,'` VARCHAR(50) NULL'), 'SELECT 1');
PREPARE _289 FROM @s; EXECUTE _289; DEALLOCATE PREPARE _289;

SET @c = 'eps_member';
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=@t AND COLUMN_NAME=@c)=0, CONCAT('ALTER TABLE `',@t,'` ADD COLUMN `',@c,'` TINYINT(1) NULL'), 'SELECT 1');
PREPARE _289 FROM @s; EXECUTE _289; DEALLOCATE PREPARE _289;

SET @c = 'international_worker';
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=@t AND COLUMN_NAME=@c)=0, CONCAT('ALTER TABLE `',@t,'` ADD COLUMN `',@c,'` TINYINT(1) NULL DEFAULT 0'), 'SELECT 1');
PREPARE _289 FROM @s; EXECUTE _289; DEALLOCATE PREPARE _289;

SET @c = 'previous_pf_member';
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=@t AND COLUMN_NAME=@c)=0, CONCAT('ALTER TABLE `',@t,'` ADD COLUMN `',@c,'` TINYINT(1) NULL'), 'SELECT 1');
PREPARE _289 FROM @s; EXECUTE _289; DEALLOCATE PREPARE _289;

SET @c = 'statutory_declaration_accepted';
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=@t AND COLUMN_NAME=@c)=0, CONCAT('ALTER TABLE `',@t,'` ADD COLUMN `',@c,'` TINYINT(1) NOT NULL DEFAULT 0'), 'SELECT 1');
PREPARE _289 FROM @s; EXECUTE _289; DEALLOCATE PREPARE _289;

SET @c = 'statutory_declaration_at';
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=@t AND COLUMN_NAME=@c)=0, CONCAT('ALTER TABLE `',@t,'` ADD COLUMN `',@c,'` DATETIME NULL'), 'SELECT 1');
PREPARE _289 FROM @s; EXECUTE _289; DEALLOCATE PREPARE _289;

SET @c = 'otp_verified';
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=@t AND COLUMN_NAME=@c)=0, CONCAT('ALTER TABLE `',@t,'` ADD COLUMN `',@c,'` TINYINT(1) NOT NULL DEFAULT 0'), 'SELECT 1');
PREPARE _289 FROM @s; EXECUTE _289; DEALLOCATE PREPARE _289;

SET @c = 'otp_verified_at';
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=@t AND COLUMN_NAME=@c)=0, CONCAT('ALTER TABLE `',@t,'` ADD COLUMN `',@c,'` DATETIME NULL'), 'SELECT 1');
PREPARE _289 FROM @s; EXECUTE _289; DEALLOCATE PREPARE _289;

SET @c = 'otp_mobile';
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=@t AND COLUMN_NAME=@c)=0, CONCAT('ALTER TABLE `',@t,'` ADD COLUMN `',@c,'` VARCHAR(20) NULL'), 'SELECT 1');
PREPARE _289 FROM @s; EXECUTE _289; DEALLOCATE PREPARE _289;

-- ── candidate_onboarding_experience additions ─────────────────────────────────
SET @t = 'candidate_onboarding_experience';

SET @c = 'from_date';
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=@t AND COLUMN_NAME=@c)=0, CONCAT('ALTER TABLE `',@t,'` ADD COLUMN `',@c,'` DATE NULL'), 'SELECT 1');
PREPARE _289 FROM @s; EXECUTE _289; DEALLOCATE PREPARE _289;

SET @c = 'to_date';
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=@t AND COLUMN_NAME=@c)=0, CONCAT('ALTER TABLE `',@t,'` ADD COLUMN `',@c,'` DATE NULL'), 'SELECT 1');
PREPARE _289 FROM @s; EXECUTE _289; DEALLOCATE PREPARE _289;

SET @c = 'reason_for_leaving';
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=@t AND COLUMN_NAME=@c)=0, CONCAT('ALTER TABLE `',@t,'` ADD COLUMN `',@c,'` VARCHAR(500) NULL'), 'SELECT 1');
PREPARE _289 FROM @s; EXECUTE _289; DEALLOCATE PREPARE _289;

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
