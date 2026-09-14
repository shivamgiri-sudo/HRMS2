-- 1043_escalation_matrix_unique_and_fractional.sql
--
-- Makes escalation_matrix_master seeds genuinely idempotent, and stops sub-hour escalation
-- delays being rounded away.
--
-- PROBLEM 1 — INSERT IGNORE that cannot ignore anything
-- 1041_ats_sla_tat_rules_seed.sql states at the top:
--     "Safe to re-run: INSERT IGNORE skips duplicates on unique key (task_type, branch_id)"
-- That holds for tat_matrix_master, which really does have uq_task_branch. It is false for
-- escalation_matrix_master: the only unique index is PRIMARY(id), and every INSERT supplies
-- a fresh UUID(), so no row can ever collide and INSERT IGNORE degrades to a plain INSERT.
-- A second run of 1041 would silently duplicate all three ATS_QUEUE_WAIT ladders, and the
-- escalation worker would then notify each role twice.
--
-- This is the third instance of the same pattern in this codebase: the LMS snapshot tables
-- before migration 1030, ats_assessment_template's boot-race seeder, and now here. The
-- clause reads as protection while providing none. A unique key is what actually makes it
-- work.
--
-- There is no branch_id column on this table, so the natural key is
-- (task_type, escalation_level) — one ladder rung per task type. Both columns are NOT NULL,
-- so the "NULLs never collide in a MySQL UNIQUE index" trap does not apply here.
--
-- Verified before writing: 28 rows, 0 collisions on that pair, so the key can be added
-- without deduplicating anything.
--
-- PROBLEM 2 — trigger_after_hours is INT
-- Exactly the defect migration 1042 fixed on tat_matrix_master.default_tat_hours: an
-- escalation configured to fire 30 minutes after breach would be stored as 1 hour and fire
-- twice as late, with no error. No current row is affected — every seeded value (0, 1, 2) is
-- a whole number — so this changes no data. It removes a trap rather than fixing damage.
--
-- ADDITIVE and idempotent: the key is added only if absent, and the column change is a
-- widening conversion. Rollback at the foot.

SET NAMES utf8mb4;
SET @db := DATABASE();

-- ---------------------------------------------------------------------------
-- 1. The unique key the seed has always assumed.
--    Guarded because MySQL has no ADD UNIQUE KEY IF NOT EXISTS.
-- ---------------------------------------------------------------------------
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA=@db AND TABLE_NAME='escalation_matrix_master'
      AND INDEX_NAME='uq_escalation_task_level') = 0,
  'ALTER TABLE escalation_matrix_master
     ADD UNIQUE KEY uq_escalation_task_level (task_type, escalation_level)',
  'SELECT ''uq_escalation_task_level exists'''));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------------
-- 2. Allow sub-hour escalation delays, matching 1042 on tat_matrix_master.
--    Widening only; 0/1/2 become 0.00/1.00/2.00.
-- ---------------------------------------------------------------------------
ALTER TABLE escalation_matrix_master
  MODIFY COLUMN trigger_after_hours DECIMAL(6,2) NOT NULL
  COMMENT 'Hours after breach; fractional allowed — 0.5 = 30 minutes. Was INT, which rounded.';

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- The key exists and is unique (SHOW INDEX, not information_schema — its UPPERCASE
-- keys make such assertions silently invert):
--   SHOW INDEX FROM escalation_matrix_master WHERE Key_name='uq_escalation_task_level';
--   -- expect 2 rows, Non_unique = 0
--
-- Re-running 1041 is now genuinely a no-op:
--   SELECT COUNT(*) FROM escalation_matrix_master WHERE task_type='ATS_QUEUE_WAIT';
--   -- expect 3, before and after
--
-- Nothing was lost:
--   SELECT COUNT(*) FROM escalation_matrix_master;   -- expect 28
--
-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
-- ALTER TABLE escalation_matrix_master DROP INDEX uq_escalation_task_level;
-- ALTER TABLE escalation_matrix_master MODIFY COLUMN trigger_after_hours INT NOT NULL;
