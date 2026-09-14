-- 1122_employees_aadhaar_blind_index.sql
--
-- Adds employees.aadhaar_blind_index, the missing half of the lookup path for encrypted
-- statutory identifiers.
--
-- WHY
--   employees.aadhaar_number and .pan_number are now fully encrypted alongside their plaintext
--   (30,108 and 23,341 rows, measured 2026-08-10). The plaintext cannot be removed until every
--   exact-match lookup has somewhere else to go, and the duplicate-employee guard in
--   employee-creation-orchestrator.service.ts is exactly such a lookup: it compares
--   e.aadhaar_number and e.pan_number directly. That guard exists because on 2026-08-05 one
--   person became three employees rows (MAS63086 against MAS62457) and misrouted 29 HR
--   escalations.
--
--   pan_blind_index already exists, char(64), with idx_employees_pan_blind. There is no Aadhaar
--   equivalent — and Aadhaar is the better key of the two: 1,043 of 1,117 active employees carry
--   one (93%) against PAN's 915 (82%).
--
-- WHAT THIS DOES NOT DO
--   Adds a nullable column and its index. Nothing writes it and nothing reads it, so applying
--   this changes no behaviour. Population is a separate, explicitly-run backfill
--   (scripts/statutory-blind-index-backfill.ts) that must execute on the production host,
--   because a blind index computed with the development key silently matches nothing —
--   which would reinstate the duplicate hole rather than close it.
--
--   conversion-duplicate-identity.contract.test.ts asserts the orchestrator does NOT key on
--   pan_blind_index, precisely because it is empty. That assertion stays correct until the
--   backfill has run and been verified, and must be flipped in the same commit that migrates
--   the guard — never before.
--
-- SHAPE
--   char(64) matches pan_blind_index exactly: blindIndex() in shared/fieldEncryption.ts is
--   HMAC-SHA256 hex, always 64 characters. Nullable, because most rows have no Aadhaar and a
--   blind index of an absent value is meaningless — NULL also keeps it out of the index.
--
-- IDEMPOTENCY
--   MySQL 8.0.42 rejects `ADD COLUMN IF NOT EXISTS` (MariaDB syntax) with ER_PARSE_ERROR, so
--   both statements are guarded through information_schema and PREPARE. The index is guarded
--   separately against STATISTICS: the column can exist while the index does not, if a previous
--   run stopped between the two.

SET @col_exists := (
  SELECT COUNT(1) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'employees'
     AND column_name = 'aadhaar_blind_index'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE employees ADD COLUMN aadhaar_blind_index CHAR(64) NULL COMMENT ''HMAC-SHA256 of aadhaar_number for exact-match lookup without plaintext''',
  'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(1) FROM information_schema.statistics
   WHERE table_schema = DATABASE()
     AND table_name = 'employees'
     AND index_name = 'idx_employees_aadhaar_blind'
);
SET @ddl := IF(@idx_exists = 0,
  'CREATE INDEX idx_employees_aadhaar_blind ON employees (aadhaar_blind_index)',
  'SELECT 1');
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
