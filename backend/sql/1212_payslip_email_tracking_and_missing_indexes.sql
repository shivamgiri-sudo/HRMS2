-- Migration 1212: create the payslip email-tracking columns two live payroll endpoints
-- already depend on, plus two indexes, none of which exist in production.
--
-- WHY THIS IS NEEDED
--   Migration 402 declared four columns and one index in a single statement using
--   `ADD COLUMN IF NOT EXISTS`, which this server's MySQL 8.0.42 rejects with ER_PARSE_ERROR at
--   the `IF NOT EXISTS` token — the migration-1006 / 398 failure mode. 402 is nevertheless
--   RECORDED AS APPLIED in schema_migrations. Two of its four columns exist (payslip_generated,
--   payslip_generated_at, added out of band); the other two never did.
--
--   Verified live over the public host 2026-08-13: salary_prep_line has payslip_generated and
--   payslip_generated_at only, and neither idx_spl_payslip_gen nor
--   profile_update_approval.idx_branch_status exists.
--
-- WHAT IS BROKEN WITHOUT IT
--   Both endpoints are in payrollMoreRouter, reachable and unshadowed (checked against every
--   router mounted on /api/payroll ahead of it), so they are not dead code — they fail every
--   time they are called:
--
--   1. POST /api/payroll/runs/:id/email-payslips — its only statement is
--        UPDATE salary_prep_line SET payslip_emailed = 1, payslip_emailed_at = NOW() ...
--      which raises ER_BAD_FIELD_ERROR. Payslips can never be marked as emailed.
--   2. GET /api/payroll/runs/:id/bulk-payslip-summary — SELECTs COALESCE(payslip_emailed,0),
--      so the bulk payslip summary 500s outright rather than returning a partial figure.
--
--   Neither is wrapped in a catch, so these surface as 500s rather than silent zeroes. That is
--   the better failure of the two, but it still means the feature has never worked.
--
-- WHY ONLY THESE TWO COLUMNS
--   payslip_generated and payslip_generated_at already exist and are in active use; re-adding
--   them is guarded and would be a no-op, but they are deliberately not listed here — this file
--   creates only what is genuinely absent, so its diff is the gap and nothing else.
--
-- ADDITIVE AND IDEMPOTENT BY CONSTRUCTION
--   payslip_emailed is NOT NULL DEFAULT 0, which is the correct reading of every existing row:
--   no payslip has ever been marked emailed, because the column that would record it never
--   existed. payslip_emailed_at is nullable. Both indexes are pure read-path additions. Every
--   statement is guarded on information_schema, so re-running is a true no-op, including on any
--   environment where 402 or 262 did succeed. No payroll figure is read, written or affected.
--
-- ROLLBACK:
--   ALTER TABLE salary_prep_line DROP INDEX idx_spl_payslip_gen;
--   ALTER TABLE salary_prep_line DROP COLUMN payslip_emailed_at, DROP COLUMN payslip_emailed;
--   ALTER TABLE profile_update_approval DROP INDEX idx_branch_status;

SET @c_payslip_emailed = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_line'
     AND COLUMN_NAME = 'payslip_emailed'
);
SET @sql = IF(@c_payslip_emailed = 0,
  'ALTER TABLE salary_prep_line ADD COLUMN payslip_emailed TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''1 once the payslip for this line has been emailed''',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c_payslip_emailed_at = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_line'
     AND COLUMN_NAME = 'payslip_emailed_at'
);
SET @sql = IF(@c_payslip_emailed_at = 0,
  'ALTER TABLE salary_prep_line ADD COLUMN payslip_emailed_at DATETIME NULL COMMENT ''When the payslip for this line was emailed''',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @i_payslip_gen = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_line'
     AND INDEX_NAME = 'idx_spl_payslip_gen'
);
SET @sql = IF(@i_payslip_gen = 0,
  'CREATE INDEX idx_spl_payslip_gen ON salary_prep_line (run_id, payslip_generated)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- From migration 262, whose columns landed but whose index did not. profile_update_approval is
-- scanned by branch and status on the WFM approval queues; without this the queue table-scans.
SET @i_branch_status = (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'profile_update_approval'
     AND INDEX_NAME = 'idx_branch_status'
);
SET @c_pua_branch = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'profile_update_approval'
     AND COLUMN_NAME = 'branch_id'
);
-- Guarded on the column too: 262's columns are present today, but on a rebuilt database this
-- file could run before them, and indexing a column that does not exist is a hard failure.
SET @sql = IF(@i_branch_status = 0 AND @c_pua_branch = 1,
  'CREATE INDEX idx_branch_status ON profile_update_approval (branch_id, status)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
