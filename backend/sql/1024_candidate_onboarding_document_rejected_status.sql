-- Secure candidate document viewer: allow a reviewer to actually reject a document.
--
-- Migration 272 added rejected_by, rejected_at and rejection_reason to
-- candidate_onboarding_document, but never extended document_status with the
-- matching 'rejected' value. rejectCandidateDocument() writes exactly that, so
-- under STRICT_TRANS_TABLES (live setting) every reject raised
--   ERROR 1265: Data truncated for column 'document_status'
-- Live census before this change: 0 rows with rejected_at, 0 with
-- rejection_reason — the path has never once succeeded.
--
-- 'failed' is deliberately NOT reused: it is written by automated BGV
-- verification (bgv-verification.service.ts), and the sibling table
-- ats_candidate_documents.verification_status already carries its own
-- 'rejected'. Both tables are UNIONed into one status the UI renders, so the
-- two branches must agree on the value.
--
-- Additive and backward compatible: appending a value to an ENUM leaves the
-- ordinals of existing values untouched, so the 272 stored rows are unaffected.

SET @needs_rejected = (
  SELECT COUNT(*)
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'candidate_onboarding_document'
     AND COLUMN_NAME = 'document_status'
     AND COLUMN_TYPE NOT LIKE '%''rejected''%'
);

SET @sql = IF(
  @needs_rejected = 1,
  'ALTER TABLE candidate_onboarding_document MODIFY COLUMN document_status ENUM(''uploaded'',''verification_pending'',''verified'',''mismatch'',''failed'',''manual_review'',''waived'',''deleted'',''file_missing'',''rejected'') NULL DEFAULT ''uploaded''',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
