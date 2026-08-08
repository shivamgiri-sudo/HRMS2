-- Migration 1110: Add encrypted account number column to employee_bank_detail
--
-- Strategy: additive dual-column approach
--   1. Add account_number_enc TEXT column to hold AES-256-GCM ciphertext
--      (format: base64-encoded JSON {v,iv,tag,ct} — same as fieldEncryption.ts)
--   2. Application layer reads: try account_number_enc, fall back to legacy
--      account_number for rows not yet backfilled
--   3. Application layer writes: always write account_number_enc only (new rows)
--   4. Backfill script (scripts/bank-account-encrypt-backfill.ts) migrates
--      existing 12,768 rows in batches — run AFTER deploy, before clearing old column
--   5. Migration 1111 (future, post-backfill) drops account_number column
--
-- account_number_enc is TEXT not VARBINARY — AES-256-GCM ciphertext is base64
-- and therefore safe in a TEXT column; no charset/collation issues.
-- FIELD_ENCRYPTION_KEY is required in production (fieldEncryption.ts enforces this).

-- Syntax note (2026-08-08): this was written as `ADD COLUMN IF NOT EXISTS`, which is MariaDB
-- syntax. This server is MySQL 8.0.42 and rejects it with ER_PARSE_ERROR — verified directly
-- against mas_hrms on a temporary table. So the migration could never have run here, which is
-- why account_number_enc exists in production (applied by hand) while schema_migrations has no
-- row for 1110 and the manifest never listed it. Migration 1064 was dropped from the manifest
-- for exactly this mistake; see the note in runPendingMigrations.ts.
--
-- Rewritten with the PREPARE idiom used by 181 other migrations in this directory. Deliberately
-- NOT a bare `ADD COLUMN`: the runner would tolerate the resulting ER_DUP_FIELDNAME, but only by
-- pushing the file onto migrationHealth.skipped, which is not the same as recorded-as-applied.
-- The conditional runs clean on both a database that already has the column and a fresh one.

SET @col_exists := (
  SELECT COUNT(1) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'employee_bank_detail'
     AND column_name = 'account_number_enc'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE employee_bank_detail ADD COLUMN account_number_enc TEXT NULL COMMENT ''AES-256-GCM encrypted account number (fieldEncryption.ts format). NULL = not yet backfilled; fall back to legacy account_number column.'' AFTER account_number',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
