-- Reconcile the last two columns 138 and 141 disagree on.
--
-- ats_branch_head_approval is created by two migrations with CREATE TABLE
-- IF NOT EXISTS, and each declares a column the other omits:
--
--   138_ats_complete_journey.sql:202   has candidate_id, no employee_code_generated
--   141_branch_head_approval.sql:19    has employee_code_generated, no candidate_id
--
-- Production was built from 141, so `candidate_id` does not exist there — yet
-- payroll-hr.service.ts:435 inserts it and joining-control-room.service.ts:117
-- joins on it. 1054 and 1055 fixed the enum and the four missing timestamp /
-- nullability columns; this closes the remaining gap.
--
-- Nothing added here is required by the new branch-head history or journey code:
-- both reach the candidate through payroll_validation_id, which exists in BOTH
-- shapes, precisely because production runs with SKIP_MIGRATIONS=true and this
-- file may sit unapplied for a long time. Applying it simply lets the older
-- call sites work and makes the two schemas agree.

-- ── candidate_id ────────────────────────────────────────────────────────────
SET @has := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_branch_head_approval'
                AND COLUMN_NAME = 'candidate_id');
SET @sql := IF(@has = 0,
  'ALTER TABLE ats_branch_head_approval ADD COLUMN candidate_id CHAR(36) NULL COMMENT ''Direct link to ATS candidate for easier queries''',
  'SELECT ''candidate_id present'' AS message');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @has := (SELECT COUNT(*) FROM information_schema.STATISTICS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_branch_head_approval'
                AND INDEX_NAME = 'idx_bha_candidate');
SET @sql := IF(@has = 0,
  'ALTER TABLE ats_branch_head_approval ADD INDEX idx_bha_candidate (candidate_id)',
  'SELECT ''idx_bha_candidate present'' AS message');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── employee_code_generated ─────────────────────────────────────────────────
SET @has := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_branch_head_approval'
                AND COLUMN_NAME = 'employee_code_generated');
SET @sql := IF(@has = 0,
  'ALTER TABLE ats_branch_head_approval ADD COLUMN employee_code_generated VARCHAR(50) NULL',
  'SELECT ''employee_code_generated present'' AS message');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ── backfill candidate_id from the validation row ───────────────────────────
-- Safe to re-run: only fills rows that are still NULL.
UPDATE ats_branch_head_approval bha
  JOIN ats_payroll_hr_validation phv ON phv.id = bha.payroll_validation_id
   SET bha.candidate_id = phv.candidate_id
 WHERE bha.candidate_id IS NULL;
