-- 606_employees_bank_account_encrypted.sql
--
-- employees.bank_account_number is the last identifier column with NO encrypted sibling.
-- Measured on production 2026-08-12: varchar(30), 28,660 of 58,840 rows populated, and
-- nothing anywhere to hold its ciphertext. Its counterpart employee_bank_detail already
-- has account_number_enc, so this column is the gap in an otherwise-complete set.
--
-- ADDITIVE ONLY. This adds the columns and nothing else:
--
--   * No backfill. Backfilling from a developer machine writes ciphertext production
--     cannot read, because FIELD_ENCRYPTION_KEY silently falls back to all-zeros outside
--     NODE_ENV=production. The backfill runs on the server, as its own authorised step.
--   * No plaintext drop. Plaintext is still the live read path; clearing it here would
--     make every bank account vanish from the application at once.
--
-- The order that must hold is: add column -> backfill -> migrate readers -> retire
-- plaintext. This file is only the first step.
--
-- Guarded with information_schema + PREPARE rather than ADD COLUMN IF NOT EXISTS, which
-- MySQL 8 rejects outright. Re-running this file is a no-op.

-- ── bank_account_number_encrypted ────────────────────────────────────────────
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'employees'
     AND COLUMN_NAME  = 'bank_account_number_encrypted'
);

SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE employees ADD COLUMN bank_account_number_encrypted TEXT NULL COMMENT ''AES-256-GCM ciphertext of bank_account_number; see shared/fieldEncryption.ts''',
  'SELECT ''employees.bank_account_number_encrypted already present'' AS note'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── bank_account_key_version ─────────────────────────────────────────────────
-- Key rotation is already versioned elsewhere; without this column a rotated key would
-- leave no way to tell which key each row was written under.
SET @ver_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'employees'
     AND COLUMN_NAME  = 'bank_account_key_version'
);

SET @ddl := IF(@ver_exists = 0,
  'ALTER TABLE employees ADD COLUMN bank_account_key_version TINYINT UNSIGNED NULL COMMENT ''FIELD_ENCRYPTION_KEY version used for bank_account_number_encrypted''',
  'SELECT ''employees.bank_account_key_version already present'' AS note'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
