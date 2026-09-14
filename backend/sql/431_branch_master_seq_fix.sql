-- 431_branch_master_seq_fix.sql
-- Fixes a live, blocking bug: branch-budget.service.ts's generateBudgetNumber() has always
-- queried branch_master.branch_seq (used to build a short numeric budget number, e.g.
-- BUD/{branchSequence}/{period}/{id}) but this column has never existed anywhere in this
-- codebase's migrations — confirmed by grep across backend/sql. Every attempt to save a new
-- branch budget on an installation without this column fails outright with
-- "Unknown column 'branch_seq' in 'field list'". Same class of schema-drift issue as
-- cost_centre_master.process_id (sql/428) and cost_centre_code/name (423) — additive fix,
-- mirroring their conditional-column pattern.
--
-- AUTO_INCREMENT as a secondary (non-primary-key) column is a standard, supported MySQL pattern
-- and requires no application-code changes: MySQL assigns the next value automatically on every
-- INSERT INTO branch_master that doesn't specify branch_seq (both existing insert call sites use
-- explicit column lists, confirmed by grep), and backfills existing rows with sequential values
-- in one ALTER TABLE.

SET @has_branch_seq = (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'branch_master'
     AND column_name = 'branch_seq'
);
SET @sql = IF(
  @has_branch_seq = 0,
  'ALTER TABLE branch_master ADD COLUMN branch_seq INT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
