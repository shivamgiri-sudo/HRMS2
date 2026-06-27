-- Migration 309: Onboarding Field Persistence & DPDP Fix
-- Safe, additive, re-runnable. No destructive changes.
-- Covers gaps identified in ONBOARDING_FIELD_GAP_AND_BACKEND_MAPPING_AUDIT.md
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 0. Fix NOT NULL constraints that break onboarding save ───────────────────
-- nominee_date_of_birth and nominee2_dob crash with empty string if not nullable
-- Safe: ALTER MODIFY only changes NULL constraint, no data loss
ALTER TABLE candidate_onboarding_profile
  MODIFY COLUMN nominee_date_of_birth DATE NULL DEFAULT NULL,
  MODIFY COLUMN nominee2_dob          DATE NULL DEFAULT NULL;

-- Also fix ats_candidate if it has these columns non-nullable
ALTER TABLE ats_candidate
  MODIFY COLUMN nominee_date_of_birth DATE NULL DEFAULT NULL;

-- ── Safe column-add procedure ─────────────────────────────────────────────────
DROP PROCEDURE IF EXISTS _309_add_col;
DELIMITER $$
CREATE PROCEDURE _309_add_col(
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

-- ── 1. candidate_onboarding_bank_detail ──────────────────────────────────────
-- GAP FIX: store nameOnCheque directly in bank_detail so it reloads on resume
CALL _309_add_col('candidate_onboarding_bank_detail', 'name_on_cheque',
  "VARCHAR(255) NULL COMMENT 'Name as printed on cancelled cheque — used for payroll HR name-match review'");

-- ── 2. candidate_onboarding_qualification ────────────────────────────────────
-- GAP FIX: board_type and institution_name were missing from INSERT in service
CALL _309_add_col('candidate_onboarding_qualification', 'board_type',
  "VARCHAR(100) NULL COMMENT 'Board or University name e.g. CBSE, Osmania University'");
CALL _309_add_col('candidate_onboarding_qualification', 'institution_name',
  "VARCHAR(255) NULL COMMENT 'School / College / Institution full name'");

-- ── 3. candidate_onboarding_experience ───────────────────────────────────────
-- from_date and to_date should already exist from migration 289, but add safely
CALL _309_add_col('candidate_onboarding_experience', 'from_date',          "DATE NULL");
CALL _309_add_col('candidate_onboarding_experience', 'to_date',            "DATE NULL");
CALL _309_add_col('candidate_onboarding_experience', 'reason_for_leaving', "VARCHAR(500) NULL");

-- ── 4. candidate_onboarding_profile — DPDP & BGV consent flags ───────────────
-- dpdp_consent and bgv_consent should already exist from migration 298, but add safely
CALL _309_add_col('candidate_onboarding_profile', 'dpdp_consent',     "TINYINT(1) NOT NULL DEFAULT 0");
CALL _309_add_col('candidate_onboarding_profile', 'dpdp_consent_at',  "DATETIME NULL");
CALL _309_add_col('candidate_onboarding_profile', 'bgv_consent',      "TINYINT(1) NOT NULL DEFAULT 0");
CALL _309_add_col('candidate_onboarding_profile', 'bgv_consent_at',   "DATETIME NULL");

-- ── 5. candidate_onboarding_profile — additional fields for completeness ──────
CALL _309_add_col('candidate_onboarding_profile', 'present_state',
  "VARCHAR(100) NULL COMMENT 'Present / current state of residence'");
CALL _309_add_col('candidate_onboarding_profile', 'permanent_state',
  "VARCHAR(100) NULL COMMENT 'Permanent / home state'");

-- ── 6. candidate_bgv_consent — ensure consent_version exists ─────────────────
DROP PROCEDURE IF EXISTS _309_add_col;

-- ── 7. Add index on candidate_onboarding_language if missing ─────────────────
-- Allows fast language lookup on resume
DROP PROCEDURE IF EXISTS _309_add_idx;
DELIMITER $$
CREATE PROCEDURE _309_add_idx()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'candidate_onboarding_language'
      AND INDEX_NAME = 'idx_candidate_lang'
  ) THEN
    ALTER TABLE candidate_onboarding_language
      ADD INDEX idx_candidate_lang (candidate_id, language_name(50));
  END IF;
END$$
DELIMITER ;
CALL _309_add_idx();
DROP PROCEDURE IF EXISTS _309_add_idx;

-- ── 8. Update page_catalog entries (idempotent) ──────────────────────────────
INSERT IGNORE INTO page_catalog (id, page_code, page_name, page_path, module, description)
VALUES
  (UUID(), 'CANDIDATE_ONBOARDING_FULL_V2', 'Candidate Onboarding (Full v2)', '/onboard-full', 'ATS',
   '10-step mobile-first onboarding form with DPDP consent, language reload, board_type, cheque name'),
  (UUID(), 'ONBOARDING_FIELD_AUDIT',       'Onboarding Field Audit Doc',     '/docs/audit',   'ATS',
   'ONBOARDING_FIELD_GAP_AND_BACKEND_MAPPING_AUDIT.md — field gap findings and fixes');
