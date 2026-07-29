-- 418_conversion_missing_columns.sql
--
-- Candidate-to-employee conversion has never once succeeded. On live data:
--
--   ats_onboarding_bridge:  264 rows, 0 with employee_id
--   ats_employment_offer:   6 bh_approved, 7 bh_rejected
--   employee_code_sequence: last_generated_code = NULL
--
-- Six Branch Heads approved offers and no employee was produced. The cause is
-- that createEmployeeFromCandidate writes columns that do not exist, and every
-- one of those writes sits inside the transaction, so ER_BAD_FIELD_ERROR rolls
-- the whole conversion back.
--
-- Most of the mismatches are fixed in code by using the real column names
-- (aadhaar_id, snapshot_date/effective_date, balance_year, leave_code). Two
-- columns genuinely do not exist and are added here.
--
-- Additive and re-runnable. No data is modified.

-- ---------------------------------------------------------------------------
-- 1. ats_onboarding_bridge.converted_at
--    Records when the candidate became an employee. Written by the orchestrator
--    when it links the bridge row.
-- ---------------------------------------------------------------------------
SET @exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'ats_onboarding_bridge'
     AND COLUMN_NAME = 'converted_at');

SET @sql := IF(@exists = 0,
  'ALTER TABLE ats_onboarding_bridge ADD COLUMN converted_at DATETIME NULL AFTER employee_code',
  'SELECT ''ats_onboarding_bridge.converted_at already exists'' AS message');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- 2. ats_employment_offer.approved_at
--    Stamped when the offer reaches 'bh_approved'.
-- ---------------------------------------------------------------------------
SET @exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'ats_employment_offer'
     AND COLUMN_NAME = 'approved_at');

SET @sql := IF(@exists = 0,
  'ALTER TABLE ats_employment_offer ADD COLUMN approved_at DATETIME NULL AFTER status',
  'SELECT ''ats_employment_offer.approved_at already exists'' AS message');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
--   FROM information_schema.COLUMNS
--  WHERE TABLE_SCHEMA = DATABASE()
--    AND ((TABLE_NAME = 'ats_onboarding_bridge' AND COLUMN_NAME = 'converted_at')
--      OR (TABLE_NAME = 'ats_employment_offer'  AND COLUMN_NAME = 'approved_at'));
--   -- expect exactly 2 rows
