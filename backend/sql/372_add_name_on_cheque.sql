-- Migration 372: Add name_on_cheque to candidate_onboarding_bank_detail
-- Safe to run multiple times (information_schema guard)

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'candidate_onboarding_bank_detail'
    AND COLUMN_NAME = 'name_on_cheque'
);
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE candidate_onboarding_bank_detail ADD COLUMN name_on_cheque VARCHAR(255) NULL COMMENT ''Name as printed on cancelled cheque'' AFTER cancelled_cheque_document_id',
  'SELECT ''Column already exists'' AS result'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
