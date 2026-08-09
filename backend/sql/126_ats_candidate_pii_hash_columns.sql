-- CI-001 fix: add hash columns alongside the masked display columns on ats_candidate
-- These store SHA-256 digests of the raw PII so deduplication/verification is still possible
-- without storing the original values. The display columns retain masked strings only.
-- NOTE: Migration runner handles "Duplicate column" errors as idempotent
ALTER TABLE ats_candidate ADD COLUMN aadhar_number_hash CHAR(64) NULL AFTER aadhar_number;
ALTER TABLE ats_candidate ADD COLUMN pan_number_hash CHAR(64) NULL AFTER pan_number;
ALTER TABLE ats_candidate ADD COLUMN bank_account_no_hash CHAR(64) NULL AFTER bank_account_no;
