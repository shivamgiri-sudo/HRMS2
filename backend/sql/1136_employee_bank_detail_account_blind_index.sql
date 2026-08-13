-- 1136_employee_bank_detail_account_blind_index.sql
--
-- Adds employee_bank_detail.account_number_blind_index, the missing lookup path for a
-- cross-employee duplicate-account check.
--
-- WHY
--   account_number_enc is AES-256-GCM with a random IV per encryptField() call (see
--   shared/fieldEncryption.ts), so two rows holding the same account number never produce
--   the same ciphertext — "WHERE account_number_enc = ?" can never find a duplicate. There
--   is also no unique constraint on account_number/account_number_enc, and no application
--   check anywhere on the live bank-write paths (PUT /:employeeId/bank-details,
--   PATCH /api/payroll/bank-change-requests/:id) for an account number already belonging to
--   a different employee. Confirmed via the profile-trust-audit (2026-08-13): a real
--   fraud-detection duplicate check exists for ATS candidate onboarding
--   (checkDuplicates() -> DUPLICATE_BANK_ACCOUNT) but never runs on the profile Bank tab.
--
--   Exactly the same shape as 1122_employees_aadhaar_blind_index.sql: an HMAC-SHA256 blind
--   index is deterministic for the same plaintext under the same key, so an exact-match
--   lookup works without ever decrypting or storing plaintext for the comparison.
--
-- WHAT THIS DOES NOT DO
--   Adds a nullable column and its index. Nothing writes it and nothing reads it yet, so
--   applying this changes no behaviour. This migration is intentionally NOT added to
--   MIGRATION_MANIFEST in backend/src/db/runPendingMigrations.ts — do not add it there
--   until the sequence below has actually run, verified, on the production host:
--
--     1. Apply this migration (adds the column + index only).
--     2. Run a backfill (not included here — see the note in
--        1122_employees_aadhaar_blind_index.sql for why: a blind index computed with the
--        development FIELD_BLIND_INDEX_KEY silently matches nothing, which would make the
--        duplicate check pass everything and give false confidence rather than catch real
--        duplicates) that populates account_number_blind_index for every existing
--        employee_bank_detail row from its resolved account number
--        (shared/fieldEncryption.ts resolveAccountNumber()).
--     3. Only then wire application code that writes this column on every new/changed bank
--        detail row and queries it for the cross-employee duplicate check. Shipping that
--        code before step 1 has run against the target database breaks every bank-detail
--        write outright (unknown column). Shipping it before step 2 makes the duplicate
--        check silently useless against pre-existing rows (it would only catch collisions
--        among rows written after the backfill).
--
-- SHAPE
--   char(64), matching pan_blind_index and aadhaar_blind_index exactly — blindIndex() in
--   shared/fieldEncryption.ts is HMAC-SHA256 hex, always 64 characters. Nullable: rows with
--   no resolvable account number (see AccountSourceStatus 'missing' in fieldEncryption.ts)
--   have nothing to index.
--
-- IDEMPOTENCY
--   MySQL 8.0.42 rejects `ADD COLUMN IF NOT EXISTS` (MariaDB syntax) with ER_PARSE_ERROR, so
--   both statements are guarded through information_schema and PREPARE, same as 1122.

SET @col_exists := (
  SELECT COUNT(1) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'employee_bank_detail'
     AND column_name = 'account_number_blind_index'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE employee_bank_detail ADD COLUMN account_number_blind_index CHAR(64) NULL COMMENT ''HMAC-SHA256 of account_number for cross-employee duplicate lookup without plaintext''',
  'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(1) FROM information_schema.statistics
   WHERE table_schema = DATABASE()
     AND table_name = 'employee_bank_detail'
     AND index_name = 'idx_bank_detail_account_blind'
);
SET @ddl := IF(@idx_exists = 0,
  'CREATE INDEX idx_bank_detail_account_blind ON employee_bank_detail (account_number_blind_index)',
  'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
