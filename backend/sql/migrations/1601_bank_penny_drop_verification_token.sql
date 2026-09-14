-- Migration 1601: Bank penny drop — verification token + name-match result columns
--
-- Adds the fields required for the employee bank-change penny drop email flow:
--   1. verification_token / verification_token_expires_at — a one-time secure token
--      emailed to Payroll Branch so they can trigger live penny drop without a password.
--   2. employee_name_at_request — snapshot of the employee's full name at submission time,
--      used as the "expected" name fed into classifyNameMatch() against the bank's returned
--      beneficiary name.
--   3. name_match_tier / name_match_score — result of classifyNameMatch() stored after
--      penny drop executes, surfaced in the Payroll HO approval queue.
--
-- Idempotent: each statement is guarded by information_schema before ALTER.
-- No existing row values are changed. penny_drop_status ENUM is extended with
-- 'name_mismatch' (already used in onboarding flow; additive on this table).

SET @col_token := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'bank_penny_drop_log'
    AND COLUMN_NAME  = 'verification_token'
);
SET @sql_token := IF(@col_token = 0,
  'ALTER TABLE bank_penny_drop_log ADD COLUMN verification_token VARCHAR(64) NULL UNIQUE AFTER penny_drop_status',
  'SELECT ''verification_token already exists'' AS info'
);
PREPARE _s FROM @sql_token; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @col_exp := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'bank_penny_drop_log'
    AND COLUMN_NAME  = 'verification_token_expires_at'
);
SET @sql_exp := IF(@col_exp = 0,
  'ALTER TABLE bank_penny_drop_log ADD COLUMN verification_token_expires_at DATETIME NULL AFTER verification_token',
  'SELECT ''verification_token_expires_at already exists'' AS info'
);
PREPARE _s FROM @sql_exp; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @col_empname := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'bank_penny_drop_log'
    AND COLUMN_NAME  = 'employee_name_at_request'
);
SET @sql_empname := IF(@col_empname = 0,
  'ALTER TABLE bank_penny_drop_log ADD COLUMN employee_name_at_request VARCHAR(255) NULL AFTER verification_token_expires_at',
  'SELECT ''employee_name_at_request already exists'' AS info'
);
PREPARE _s FROM @sql_empname; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @col_tier := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'bank_penny_drop_log'
    AND COLUMN_NAME  = 'name_match_tier'
);
SET @sql_tier := IF(@col_tier = 0,
  'ALTER TABLE bank_penny_drop_log ADD COLUMN name_match_tier VARCHAR(20) NULL AFTER employee_name_at_request',
  'SELECT ''name_match_tier already exists'' AS info'
);
PREPARE _s FROM @sql_tier; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @col_score := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'bank_penny_drop_log'
    AND COLUMN_NAME  = 'name_match_score'
);
SET @sql_score := IF(@col_score = 0,
  'ALTER TABLE bank_penny_drop_log ADD COLUMN name_match_score INT NULL AFTER name_match_tier',
  'SELECT ''name_match_score already exists'' AS info'
);
PREPARE _s FROM @sql_score; EXECUTE _s; DEALLOCATE PREPARE _s;

-- Extend penny_drop_status ENUM to include 'name_mismatch' (already present in
-- onboarding tables; this table's original ENUM was: initiated,success,failed,skipped).
-- MySQL MODIFY COLUMN on an ENUM is idempotent-safe — re-listing all values is required.
ALTER TABLE bank_penny_drop_log
  MODIFY COLUMN penny_drop_status
    ENUM('initiated','success','failed','skipped','name_mismatch') NOT NULL DEFAULT 'initiated';

-- Index on verification_token for O(1) token lookup (already unique, MySQL adds index automatically).
-- Index on employee_id + penny_drop_status already exists per migration 293.