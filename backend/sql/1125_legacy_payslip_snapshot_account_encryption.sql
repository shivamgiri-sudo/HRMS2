-- 1125_legacy_payslip_snapshot_account_encryption.sql
--
-- Adds the encrypted-at-rest columns for legacy_payslip_snapshot.account_number.
--
-- WHY THIS IS THE LARGEST REMAINING EXPOSURE
--   Measured live 2026-08-10: 115,698 populated bank account numbers, 18,521 distinct,
--   varchar(50), with NO protected sibling of any kind — no _enc, no _hash, no _masked.
--   That is roughly four times the volume of the employees table that was encrypted on
--   2026-08-09 (aadhaar 30,108 / pan 23,341), and it sits in a database whose 3306 answers
--   from the internet. The privacy-encryption-coverage scan classifies it
--   NO_PROTECTED_COLUMN_EXISTS, the worst of its three categories, and by row count it is the
--   single biggest entry in that report.
--
-- THE COLUMN IS DEAD, THE TABLE IS NOT
--   legacy_payslip_snapshot itself is very much alive: it is salary source #3 for appointment
--   letters (letters/appointmentLetterData.service.ts), it backs the eligibility check, and
--   payroll.executor.ts calls its `arrear` column "the only arrear column anywhere". So the
--   table cannot be dropped.
--
--   Its account_number column, though, is read by nothing. Verified across backend/src and
--   src: there is no reference to lps.account_number or to legacy_payslip_snapshot.account_number
--   anywhere. Every account_number in payroll.routes.ts and payroll.executor.ts is qualified to
--   a different table — ebd.account_number (employee_bank_detail) or e.bank_account_number
--   (employees) — so none of them can resolve here. The one `SELECT *` against this table
--   (appointmentLetterData.service.ts:165) destructures an explicit allow-list of salary
--   fields and never touches account_number, so it does not reach a response either.
--
--   That matters more than it sounds. For employees.pan_number the expensive part of retiring
--   plaintext is migrating ~10 readers. Here there are none, so backfill can be followed
--   directly by clearing the plaintext with nothing to migrate in between.
--
-- WHY ENCRYPT RATHER THAN SIMPLY SCRUB
--   Scrubbing would be simpler and, since nothing reads the column, would break nothing. But
--   these rows record which account each historical payslip was actually paid into, and only
--   105,317 of the 115,698 match the account currently on the employee record — about 10,000
--   are accounts that have since changed. In a finance system that is audit history, and
--   destroying it to solve a security problem is the wrong trade when encrypting preserves it.
--
-- BEHAVIOUR
--   Purely additive. Both columns are nullable-or-defaulted and nothing reads or writes either
--   of them, so applying this changes nothing observable. Population is a separate explicit
--   backfill (scripts/legacy-payslip-account-encrypt-backfill.mjs) that must run on the
--   production host, where FIELD_ENCRYPTION_KEY exists — run anywhere else it silently uses the
--   all-zeros dev key and writes ciphertext production can never decrypt.
--
-- NO updated_at HAZARD HERE
--   Unlike employees, this table has no `on update CURRENT_TIMESTAMP` column and no triggers
--   (both verified live), so the backfill needs none of the `updated_at = updated_at`
--   suppression that the employees backfill required.
--
-- IDEMPOTENCY
--   MySQL 8.0.42 rejects `ADD COLUMN IF NOT EXISTS` (MariaDB syntax) with ER_PARSE_ERROR, so
--   each statement is guarded through information_schema and PREPARE. Each column is guarded
--   separately rather than combined into one ALTER, following 1123 — a single multi-column
--   statement is all-or-nothing and one ER_DUP_FIELDNAME ends the whole file.
--
-- ROLLBACK
--   ALTER TABLE legacy_payslip_snapshot DROP COLUMN account_number_enc;
--   ALTER TABLE legacy_payslip_snapshot DROP COLUMN account_enc_key_version;
--   Safe at any point before the plaintext is cleared, since nothing reads either column.

-- legacy_payslip_snapshot.account_number_enc
SET @c := (SELECT COUNT(1) FROM information_schema.columns
            WHERE table_schema = DATABASE() AND table_name = 'legacy_payslip_snapshot'
              AND column_name = 'account_number_enc');
SET @ddl := IF(@c = 0,
  'ALTER TABLE legacy_payslip_snapshot ADD COLUMN account_number_enc TEXT NULL COMMENT ''AES-256-GCM ciphertext of account_number''',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- legacy_payslip_snapshot.account_enc_key_version
SET @c := (SELECT COUNT(1) FROM information_schema.columns
            WHERE table_schema = DATABASE() AND table_name = 'legacy_payslip_snapshot'
              AND column_name = 'account_enc_key_version');
SET @ddl := IF(@c = 0,
  'ALTER TABLE legacy_payslip_snapshot ADD COLUMN account_enc_key_version TINYINT NOT NULL DEFAULT 1 COMMENT ''Key version used for account_number_enc''',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Verification — expects both columns present, and both empty until the backfill runs:
--   SELECT COUNT(*) AS rows_total,
--          SUM(account_number IS NOT NULL AND TRIM(account_number) <> '') AS plaintext,
--          SUM(account_number_enc IS NOT NULL)                            AS ciphertext
--     FROM legacy_payslip_snapshot;
--   expect plaintext = 115698, ciphertext = 0
