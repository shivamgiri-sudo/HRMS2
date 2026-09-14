-- Migration: 443_fraud_alert_type_enum_extend.sql
-- Purpose: Extend candidate_fraud_alert.alert_type ENUM to include values the
--          application has been inserting since ocr.service.ts was written.
-- Date: 2026-08-25
-- Issue: ocr.service.ts's runDuplicateCheck() inserts alert_type='REPEAT_APPLICANT'
--        when a duplicate Aadhaar/PAN/bank match turns out to be the same person
--        re-applying (ocr.service.ts:337), and recordCheckFailure() inserts
--        alert_type='FRAUD_CHECK_FAILED' when a duplicate check itself throws
--        (ocr.service.ts:253-269). Neither value is in the ENUM defined by
--        403_fraud_detection_security.sql:20-24
--        ('DUPLICATE_AADHAAR','DUPLICATE_PAN','DUPLICATE_BANK_ACCOUNT',
--        'DOCUMENT_NUMBER_MISMATCH','NAME_MISMATCH','FACE_MISMATCH',
--        'PROVIDER_NUMBER_MISMATCH','CHEQUE_ACCOUNT_MISMATCH'), so both inserts
--        have been failing since this code was written. Worse, the failure path
--        for a REPEAT_APPLICANT insert itself calls recordCheckFailure(), whose
--        own insert also fails on the same missing-enum-value error, and that
--        second failure is swallowed by a bare .catch(() => {}) — so today
--        neither the original alert nor a record of the failure ever reaches
--        the table. This is purely additive: it only widens the ENUM, it does
--        not touch any existing value or row.

-- ============================================================================
-- Widen the ENUM, idempotently (information_schema-guarded PREPARE/EXECUTE —
-- this MySQL 8.0.42 server rejects "MODIFY COLUMN ... IF NOT EXISTS" syntax,
-- same reasoning as 442_candidate_fraud_alert_unique_constraint.sql's guard
-- for ADD CONSTRAINT).
-- ============================================================================

SET @enum_already_widened = (
  SELECT COUNT(*)
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'candidate_fraud_alert'
     AND COLUMN_NAME = 'alert_type'
     AND COLUMN_TYPE LIKE '%REPEAT_APPLICANT%'
);

SET @sql = IF(@enum_already_widened = 0,
  "ALTER TABLE candidate_fraud_alert
   MODIFY COLUMN alert_type ENUM(
     'DUPLICATE_AADHAAR','DUPLICATE_PAN','DUPLICATE_BANK_ACCOUNT',
     'DOCUMENT_NUMBER_MISMATCH','NAME_MISMATCH','FACE_MISMATCH',
     'PROVIDER_NUMBER_MISMATCH','CHEQUE_ACCOUNT_MISMATCH',
     'REPEAT_APPLICANT','FRAUD_CHECK_FAILED'
   ) NOT NULL",
  'SELECT ''alert_type ENUM already includes REPEAT_APPLICANT/FRAUD_CHECK_FAILED'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT '✓ Migration 443_fraud_alert_type_enum_extend.sql complete' AS status;
