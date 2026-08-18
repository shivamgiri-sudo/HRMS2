-- Migration 1241: minimum-wage provisional-marking columns for salary_package_master
-- and ats_offer_letters.
--
-- WHY THIS IS NEEDED
--   minimum_wage_master (028_statutory_compliance.sql) has a working CRUD API and admin
--   UI tab, and today holds 24 active rows across 6 states (DL, HR, KA, MH, TS, UP). No
--   code anywhere reads it back to validate a salary package or offer amount — it is pure
--   unenforced data. This migration adds the columns the new minimum-wage gate
--   (backend/src/modules/payroll-masters/minimum-wage-gate.service.ts) writes so a
--   created/edited salary package or generated offer letter records whether it was
--   checked against a configured floor, and if not, why not.
--
-- PATTERN REUSED, NOT INVENTED
--   This follows the same "provisional, not silently allowed, not hard-blocked" shape
--   already used for F&F (full_final_calculation.is_ff_provisional, exit/ff.service.ts)
--   and mirrors the status/reason shape returned by calculateGratuity() and calculateTds()
--   in payroll/payrollCalculate.service.ts. A boolean flag plus a short human-readable
--   note, defaulting to "not provisional" only when a configured floor was actually found
--   and the amount cleared it.
--
-- WHY BOTH TABLES GET THE SAME TWO COLUMNS
--   salary_package_master.min_wage_provisional/min_wage_check_note — written by
--   createPackage/updatePackage in payrollMasters.service.ts, checked against the
--   package's branch_name (the only location signal that table has; it is keyed by
--   branch_name text, not branch_id).
--   ats_offer_letters.min_wage_provisional/min_wage_check_note — written by
--   generateOfferLetter in ats/offer-letter.service.ts, checked against the candidate's
--   branch_id where available (ats_candidate.branch_id), falling back to the branch_name
--   text passed on the offer payload.
--
-- DEFAULT VALUE
--   min_wage_provisional defaults to 0 (not provisional) so every pre-existing row — all
--   295 rows of salary_package_master, source_db='db_bill', and every historical offer
--   letter — reads as "not evaluated", not "flagged as a problem". Nothing retroactively
--   re-evaluates history; only new creates/edits run the check going forward.
--
-- ADDITIVE AND IDEMPOTENT BY CONSTRUCTION
--   information_schema-guarded PREPARE/EXECUTE, not `ADD COLUMN IF NOT EXISTS` — this
--   MySQL 8 server rejects that clause with ER_PARSE_ERROR while still recording the
--   migration as applied (the 2026-08-13 outage pattern; see 1211/1212/1224/1227/1228).
--   No DROP, no DELETE, no existing column touched, no payroll/salary calculation logic
--   changed — this is a validation-gate data column, not an arithmetic change.
--
-- ROLLBACK:
--   ALTER TABLE salary_package_master DROP COLUMN min_wage_provisional, DROP COLUMN min_wage_check_note;
--   ALTER TABLE ats_offer_letters DROP COLUMN min_wage_provisional, DROP COLUMN min_wage_check_note;

SET @c_spm_flag = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_package_master'
     AND COLUMN_NAME = 'min_wage_provisional'
);
SET @sql = IF(@c_spm_flag = 0,
  'ALTER TABLE salary_package_master ADD COLUMN min_wage_provisional TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''1 when this package was created/edited without a clean minimum-wage-floor pass (no configured floor for the branch''''s state, the state could not be resolved, or the amount is below the floor); 0 means the check ran and the amount cleared it. Never silently means "checked and fine" for pre-migration rows.''',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c_spm_note = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_package_master'
     AND COLUMN_NAME = 'min_wage_check_note'
);
SET @sql = IF(@c_spm_note = 0,
  'ALTER TABLE salary_package_master ADD COLUMN min_wage_check_note VARCHAR(255) NULL COMMENT ''Human-readable reason from the minimum-wage gate: which state it resolved to (if any), the floor compared against, or why no comparison could be made.''',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c_aol_flag = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_offer_letters'
     AND COLUMN_NAME = 'min_wage_provisional'
);
SET @sql = IF(@c_aol_flag = 0,
  'ALTER TABLE ats_offer_letters ADD COLUMN min_wage_provisional TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''Same meaning as salary_package_master.min_wage_provisional, evaluated against the candidate''''s resolved branch state and offered gross salary.''',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c_aol_note = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_offer_letters'
     AND COLUMN_NAME = 'min_wage_check_note'
);
SET @sql = IF(@c_aol_note = 0,
  'ALTER TABLE ats_offer_letters ADD COLUMN min_wage_check_note VARCHAR(255) NULL COMMENT ''Human-readable reason from the minimum-wage gate, same shape as salary_package_master.min_wage_check_note.''',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
