-- 1063_test_data_classification.sql
--
-- NOT EXECUTED. Additive DDL only — three nullable/defaulted columns on three master
-- tables. No row is modified, no row is removed. Classification of specific rows is a
-- separate, reviewed script (scripts/classify-test-data.sql), because adding the mechanism
-- and deciding which rows are test data are different decisions with different reviewers.
--
-- WHY THIS REPLACES A DELETE
--
-- The previous approach (scripts/purge-test-data-from-masters.sql) deleted test candidates
-- and empty test processes outright. Investigating the foreign key graph makes that
-- indefensible:
--
--   ats_candidate     26 inbound foreign keys, 25 of them ON DELETE CASCADE
--   employees        158 inbound foreign keys, 118 ON DELETE CASCADE
--   process_master    38 inbound foreign keys
--
-- A single DELETE from ats_candidate silently removes rows from twenty-five other tables,
-- including interview records, document uploads and audit trails. There is no dry-run for
-- a cascade and no way to see the blast radius from the statement itself. Worse,
-- ats_candidate is not a scratch table: it holds tens of thousands of rows that are
-- employee records, not applicants, so "it is only candidates" is not true either.
--
-- Deletion also destroys the evidence. The reason these rows are a problem is that a test
-- candidate reached rank 2 of the live Quality leaderboard at 96.67%. That is a reporting
-- defect — real data leaking into a customer-facing surface — and deleting the row hides
-- the defect instead of fixing it. The next test record does the same thing.
--
-- So: mark, exclude, keep. The row stays, the history stays, the audit trail stays, and
-- every surface that should not show it filters it out.
--
-- THE COLUMN IS NOT THE MECHANISM
--
-- A flag nobody filters on is worse than no flag, because it creates the appearance of a
-- solution. The exclusion contract lives in
-- backend/src/shared/testDataExclusion.ts and is enforced by a test that fails if a
-- reporting query omits it. This migration only creates the storage.
--
-- Safe to re-run: every ADD COLUMN is guarded on both the table and the column existing.

-- ─────────────────────────────────────────────────────────────────────────────
-- ats_candidate
-- ─────────────────────────────────────────────────────────────────────────────
SET @tbl = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ats_candidate');
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ats_candidate' AND COLUMN_NAME='is_test_data');
SET @sql = IF(@tbl>0 AND @col=0,
  'ALTER TABLE ats_candidate
     ADD COLUMN is_test_data TINYINT(1) NOT NULL DEFAULT 0
       COMMENT ''1 = seeded or synthetic; must be excluded from reporting and leaderboards'',
     ADD COLUMN test_data_reason VARCHAR(255) NULL,
     ADD COLUMN test_data_marked_at DATETIME NULL,
     ADD INDEX idx_ats_candidate_test_data (is_test_data)',
  'SELECT ''ats_candidate already classified'' AS n');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─────────────────────────────────────────────────────────────────────────────
-- employees
-- ─────────────────────────────────────────────────────────────────────────────
SET @tbl = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employees');
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employees' AND COLUMN_NAME='is_test_data');
SET @sql = IF(@tbl>0 AND @col=0,
  'ALTER TABLE employees
     ADD COLUMN is_test_data TINYINT(1) NOT NULL DEFAULT 0
       COMMENT ''1 = seeded or synthetic; excluded from headcount, payroll and KPI reporting'',
     ADD COLUMN test_data_reason VARCHAR(255) NULL,
     ADD COLUMN test_data_marked_at DATETIME NULL,
     ADD INDEX idx_employees_test_data (is_test_data)',
  'SELECT ''employees already classified'' AS n');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─────────────────────────────────────────────────────────────────────────────
-- process_master
-- ─────────────────────────────────────────────────────────────────────────────
SET @tbl = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='process_master');
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='process_master' AND COLUMN_NAME='is_test_data');
SET @sql = IF(@tbl>0 AND @col=0,
  'ALTER TABLE process_master
     ADD COLUMN is_test_data TINYINT(1) NOT NULL DEFAULT 0
       COMMENT ''1 = seeded or synthetic; excluded from process pickers and P&L'',
     ADD COLUMN test_data_reason VARCHAR(255) NULL,
     ADD COLUMN test_data_marked_at DATETIME NULL,
     ADD INDEX idx_process_master_test_data (is_test_data)',
  'SELECT ''process_master already classified'' AS n');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify
-- ─────────────────────────────────────────────────────────────────────────────
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_DEFAULT, IS_NULLABLE
  FROM INFORMATION_SCHEMA.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE()
   AND COLUMN_NAME IN ('is_test_data','test_data_reason','test_data_marked_at')
 ORDER BY TABLE_NAME, COLUMN_NAME;
-- EXPECT: 9 rows — three columns on each of ats_candidate, employees, process_master.
-- Every is_test_data defaults to 0, so this migration changes nothing about what any
-- existing query returns until rows are classified and callers adopt the exclusion.

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback
-- ─────────────────────────────────────────────────────────────────────────────
-- ALTER TABLE ats_candidate  DROP COLUMN is_test_data, DROP COLUMN test_data_reason, DROP COLUMN test_data_marked_at;
-- ALTER TABLE employees      DROP COLUMN is_test_data, DROP COLUMN test_data_reason, DROP COLUMN test_data_marked_at;
-- ALTER TABLE process_master DROP COLUMN is_test_data, DROP COLUMN test_data_reason, DROP COLUMN test_data_marked_at;
