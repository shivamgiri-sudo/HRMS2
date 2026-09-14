-- Migration 1215: make a generated payment file reproducible and auditable.
--
-- THE GAP
--   Nothing anywhere recorded what a bank payment file contained. The readiness gate reports
--   PAYFILE_GENERATION_NOT_REPRODUCIBLE as SOURCE_MISSING for exactly this reason: a regenerated
--   NEFT export cannot be shown to be identical to the one already submitted to the bank, and if
--   a duplicate payment is ever disputed there is no evidence trail on either side.
--
-- WHY THIS EXTENDS AN EXISTING TABLE INSTEAD OF ADDING ONE
--   payroll_register_export_log already exists, already carries run_id / generated_by /
--   generated_at / row_count, and its register_type enum already includes 'bank_register'. It has
--   a live writer in payrollCompliance.routes.ts and holds 0 rows only because that register
--   endpoint has never been called. Creating a second payment-file log beside it would be the
--   same two-rival-systems mistake this audit has been documenting elsewhere, so the NEFT export
--   is pointed at this table and the table gains the four things it lacks for that purpose:
--   what the file was called, what it hashed to, what it totalled, and who it left out.
--
-- WHAT EACH COLUMN IS FOR
--   file_name        the exact filename handed to the caller, so a file on someone's disk can be
--                    matched back to a row here.
--   content_sha256   SHA-256 of the exact CSV bytes sent. This is what makes "reproducible" a
--                    checkable claim rather than a hope: regenerate, hash, compare. Two rows for
--                    one run with DIFFERENT hashes is the duplicate-payment hazard — the file was
--                    regenerated and it changed — and that is precisely what a readiness check can
--                    now detect and a human can adjudicate.
--   total_amount     the declared payable total, so the log reconciles to payroll without
--                    reopening the file.
--   excluded_count / excluded_amount
--                    who and how much the file deliberately left out. Recording only what was paid
--                    would make an under-inclusive file indistinguishable from a complete one.
--
-- ALL NULLABLE, DELIBERATELY ADDITIVE
--   The existing compliance writer inserts without these columns and must keep working unchanged,
--   so every one is NULL-able with no default. Existing rows (there are none in production, but
--   other environments may differ) keep their current meaning exactly. No payroll figure is read
--   or written by this migration.
--
-- ROLLBACK:
--   ALTER TABLE payroll_register_export_log
--     DROP COLUMN file_name, DROP COLUMN content_sha256,
--     DROP COLUMN total_amount, DROP COLUMN excluded_count, DROP COLUMN excluded_amount;
--   (drop index idx_pre_run_hash first if present)

SET @c_file_name = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_register_export_log'
     AND COLUMN_NAME = 'file_name');
SET @sql = IF(@c_file_name = 0,
  'ALTER TABLE payroll_register_export_log ADD COLUMN file_name VARCHAR(255) NULL COMMENT ''Exact filename handed to the caller''',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c_hash = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_register_export_log'
     AND COLUMN_NAME = 'content_sha256');
SET @sql = IF(@c_hash = 0,
  'ALTER TABLE payroll_register_export_log ADD COLUMN content_sha256 CHAR(64) NULL COMMENT ''SHA-256 of the exact bytes sent; two rows for one run with different hashes means the file was regenerated AND changed''',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c_total = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_register_export_log'
     AND COLUMN_NAME = 'total_amount');
SET @sql = IF(@c_total = 0,
  'ALTER TABLE payroll_register_export_log ADD COLUMN total_amount DECIMAL(14,2) NULL COMMENT ''Declared payable total in the file''',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c_exc_n = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_register_export_log'
     AND COLUMN_NAME = 'excluded_count');
SET @sql = IF(@c_exc_n = 0,
  'ALTER TABLE payroll_register_export_log ADD COLUMN excluded_count INT NULL COMMENT ''Employees deliberately left out as unpayable''',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c_exc_amt = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_register_export_log'
     AND COLUMN_NAME = 'excluded_amount');
SET @sql = IF(@c_exc_amt = 0,
  'ALTER TABLE payroll_register_export_log ADD COLUMN excluded_amount DECIMAL(14,2) NULL COMMENT ''Net pay of the excluded employees''',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Supports the readiness check's "has this run's file been regenerated, and did it change?"
SET @i_run_hash = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payroll_register_export_log'
     AND INDEX_NAME = 'idx_pre_run_hash');
SET @sql = IF(@i_run_hash = 0,
  'CREATE INDEX idx_pre_run_hash ON payroll_register_export_log (run_id, register_type, content_sha256)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
