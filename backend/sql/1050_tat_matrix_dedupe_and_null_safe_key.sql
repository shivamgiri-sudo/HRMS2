-- 1050_tat_matrix_dedupe_and_null_safe_key.sql
--
-- Cleans up 16 duplicate rows I created, and makes the duplication impossible to repeat.
--
-- WHAT HAPPENED — my error, recorded plainly
-- Migration 1041 seeds BOTH tat_matrix_master and escalation_matrix_master. While verifying
-- 1043 I re-ran 1041 to prove it had become idempotent, and checked the result on
-- escalation_matrix_master only — the table 1043 had just given a unique key. I did not
-- check tat_matrix_master. It duplicated all 16 seeded task types.
--
-- The reason it duplicated is the trap documented in 1043's own comments: uq_task_branch is
-- UNIQUE (task_type, branch_id), every seeded row has branch_id IS NULL, and **NULLs never
-- collide in a MySQL UNIQUE index**. So INSERT IGNORE could not ignore anything. I confirmed
-- the key existed and concluded the seed was safe without checking that NULLs defeat it.
--
-- Verified before writing this: 16 duplicated task types, every pair IDENTICAL in
-- default_tat_hours, task_description and is_active, and no table carries a foreign key to
-- tat_matrix_master.id. So removing one of each pair changes no behaviour.
--
-- Today the duplication is harmless — resolveTat does ORDER BY branch_id IS NULL ASC LIMIT 1
-- and both rows are identical. It stops being harmless the moment someone edits one of them,
-- because which row wins is then arbitrary.
--
-- ---------------------------------------------------------------------------
-- 1. Remove the newer of each duplicate pair, keeping the original.
-- ---------------------------------------------------------------------------
-- Self-join rather than GROUP_CONCAT: no group_concat_max_len to trip over, and it deletes
-- exactly the rows that have an older twin.
DELETE t FROM tat_matrix_master t
  JOIN tat_matrix_master keep
    ON keep.task_type = t.task_type
   AND keep.branch_id IS NULL AND t.branch_id IS NULL
   AND (keep.created_at < t.created_at
        OR (keep.created_at = t.created_at AND keep.id < t.id));

-- ---------------------------------------------------------------------------
-- 2. Make it impossible to happen again.
--
--    MySQL cannot enforce uniqueness across NULLs, so the existing uq_task_branch will
--    always allow a duplicate branch-less row. A generated column collapses NULL to '' and
--    gives the unique index something it can actually compare.
--
--    uq_task_branch is deliberately LEFT IN PLACE — it still correctly constrains rows that
--    do carry a branch_id, and dropping it is not needed for this fix.
-- ---------------------------------------------------------------------------
SET @db := DATABASE();

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=@db AND TABLE_NAME='tat_matrix_master' AND COLUMN_NAME='branch_key') = 0,
  "ALTER TABLE tat_matrix_master
     ADD COLUMN branch_key VARCHAR(36)
       GENERATED ALWAYS AS (COALESCE(branch_id, '')) STORED
       COMMENT 'NULL-collapsed branch_id; exists only so a UNIQUE index can dedupe branch-less rows'",
  'SELECT ''branch_key exists'''));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA=@db AND TABLE_NAME='tat_matrix_master'
      AND INDEX_NAME='uq_tat_task_branchkey') = 0,
  'ALTER TABLE tat_matrix_master
     ADD UNIQUE KEY uq_tat_task_branchkey (task_type, branch_key)',
  'SELECT ''uq_tat_task_branchkey exists'''));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- No task_type appears twice for the same branch (expect ZERO rows):
--   SELECT task_type, COUNT(*) FROM tat_matrix_master
--    GROUP BY task_type, COALESCE(branch_id,'') HAVING COUNT(*) > 1;
--
-- Row count halved for the seeded set (expect 16, was 32):
--   SELECT COUNT(*) FROM tat_matrix_master;
--
-- The key now bites — re-running 1041 must add nothing:
--   SELECT COUNT(*) FROM tat_matrix_master;   -- before and after running 1041 again
--
-- Verify with SHOW INDEX, never information_schema (its UPPERCASE keys invert assertions):
--   SHOW INDEX FROM tat_matrix_master WHERE Key_name = 'uq_tat_task_branchkey';
--
-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
-- The deleted rows were exact duplicates and are not recoverable, nor worth recovering.
-- ALTER TABLE tat_matrix_master DROP INDEX uq_tat_task_branchkey;
-- ALTER TABLE tat_matrix_master DROP COLUMN branch_key;
