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

ALTER TABLE employee_bank_detail
  ADD COLUMN IF NOT EXISTS account_number_enc TEXT NULL
    COMMENT 'AES-256-GCM encrypted account number (fieldEncryption.ts format). NULL = not yet backfilled; fall back to legacy account_number column.'
    AFTER account_number;
