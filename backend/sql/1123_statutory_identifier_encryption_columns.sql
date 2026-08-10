-- 1123_statutory_identifier_encryption_columns.sql
--
-- Adds the encrypted-at-rest columns for the statutory identifiers that still have none.
--
-- WHY
--   employees was encrypted on 2026-08-10 (aadhaar 30,108 / pan 23,341, ciphertext matching
--   plaintext exactly). These three tables were not, and between them they hold roughly 54,000
--   identifier values in cleartext with nowhere to put ciphertext:
--
--     ats_candidate.aadhar_number        28,764   (has _hash and _masked, no _encrypted)
--     ats_candidate.pan_number           24,929   (has _hash and _masked, no _encrypted)
--     employee_statutory_info.pan_number  3,341   (raw only)
--     vendor_master.pan_number            1,373   (raw only)
--
--   ats_candidate matters more than its name suggests: roughly 30,000 of its 37,634 rows are
--   legacy EMPLOYEE records carried in by candidate_code, so this is staff PII, not just
--   applicant PII.
--
-- WHAT IS DELIBERATELY NOT HERE
--   employee_statutory_info.aadhaar_id gets no encrypted column, because it does not hold
--   Aadhaar numbers. Measured 2026-08-10: 3,946 populated, exactly 1 matching ^[0-9]{12}$,
--   and 9,186 values of <= 3 characters drawn from just 14 distinct strings — blank, 'NA',
--   'N/A', ',', 'NAN', 'aa'. Encrypting a placeholder column would spend a migration
--   pretending a data-quality problem is a security one. It needs identifying first.
--
--   No blind index for ats_candidate either: aadhar_number_hash and pan_number_hash already
--   exist and are already the lookup path (ocr.service.ts keys duplicate detection on
--   aadhaar_number_hash). Adding a second lookup column would create two rival indexes for one
--   value.
--
--   employee_statutory_info.pan_blind_index IS added, because the duplicate-employee guard in
--   employee-creation-orchestrator.service.ts reads s.pan_number by equality and would
--   otherwise have no lookup path once plaintext is retired.
--
-- BEHAVIOUR
--   Purely additive. Every column is nullable and nothing reads or writes any of them, so
--   applying this changes nothing observable. Population is a separate explicit backfill
--   (scripts/statutory-identifier-encrypt-backfill.ts) that must run on the production host.
--
-- IDEMPOTENCY
--   MySQL 8.0.42 rejects `ADD COLUMN IF NOT EXISTS` (MariaDB syntax) with ER_PARSE_ERROR, so
--   each statement is guarded through information_schema and PREPARE. Guarding each column
--   separately, rather than one multi-column ALTER, is deliberate: 509_portal_client_master_fixes
--   was lost precisely because eleven columns were added in a single all-or-nothing statement
--   that failed ER_DUP_FIELDNAME on one of them and ended the file.

-- ats_candidate.aadhar_number_encrypted
SET @c := (SELECT COUNT(1) FROM information_schema.columns
            WHERE table_schema = DATABASE() AND table_name = 'ats_candidate'
              AND column_name = 'aadhar_number_encrypted');
SET @ddl := IF(@c = 0,
  'ALTER TABLE ats_candidate ADD COLUMN aadhar_number_encrypted TEXT NULL COMMENT ''AES-256-GCM ciphertext of aadhar_number''',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ats_candidate.pan_number_encrypted
SET @c := (SELECT COUNT(1) FROM information_schema.columns
            WHERE table_schema = DATABASE() AND table_name = 'ats_candidate'
              AND column_name = 'pan_number_encrypted');
SET @ddl := IF(@c = 0,
  'ALTER TABLE ats_candidate ADD COLUMN pan_number_encrypted TEXT NULL COMMENT ''AES-256-GCM ciphertext of pan_number''',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- employee_statutory_info.pan_number_encrypted
SET @c := (SELECT COUNT(1) FROM information_schema.columns
            WHERE table_schema = DATABASE() AND table_name = 'employee_statutory_info'
              AND column_name = 'pan_number_encrypted');
SET @ddl := IF(@c = 0,
  'ALTER TABLE employee_statutory_info ADD COLUMN pan_number_encrypted TEXT NULL COMMENT ''AES-256-GCM ciphertext of pan_number''',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- employee_statutory_info.pan_blind_index
SET @c := (SELECT COUNT(1) FROM information_schema.columns
            WHERE table_schema = DATABASE() AND table_name = 'employee_statutory_info'
              AND column_name = 'pan_blind_index');
SET @ddl := IF(@c = 0,
  'ALTER TABLE employee_statutory_info ADD COLUMN pan_blind_index CHAR(64) NULL COMMENT ''HMAC-SHA256 of pan_number for exact-match lookup without plaintext''',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @i := (SELECT COUNT(1) FROM information_schema.statistics
            WHERE table_schema = DATABASE() AND table_name = 'employee_statutory_info'
              AND index_name = 'idx_statutory_pan_blind');
SET @ddl := IF(@i = 0,
  'CREATE INDEX idx_statutory_pan_blind ON employee_statutory_info (pan_blind_index)',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- vendor_master.pan_number_encrypted
SET @c := (SELECT COUNT(1) FROM information_schema.columns
            WHERE table_schema = DATABASE() AND table_name = 'vendor_master'
              AND column_name = 'pan_number_encrypted');
SET @ddl := IF(@c = 0,
  'ALTER TABLE vendor_master ADD COLUMN pan_number_encrypted TEXT NULL COMMENT ''AES-256-GCM ciphertext of pan_number''',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
