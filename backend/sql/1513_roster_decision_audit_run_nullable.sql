-- 1513_roster_decision_audit_run_nullable.sql
--
-- Makes roster_decision_audit.run_id NULLABLE so a manager decision on a roster that was not
-- produced by a generation run can still be audited.
--
-- Why: all four manager-review actions (realign, force-approve, escalate, reject-request) write
-- a roster_decision_audit row using COALESCE(generation_run_id, ''). run_id is NOT NULL with a
-- foreign key to roster_generation_run(id), so when an assignment has no generation run the
-- INSERT writes '' and dies on the FK:
--
--   ER_NO_REFERENCED_ROW_2 (1452): Cannot add or update a child row: a foreign key constraint
--   fails (`mas_hrms`.`roster_decision_audit`, CONSTRAINT `fk_rda_run` ...)
--
-- Verified live 2026-08-20: roster_generation_run holds 0 rows, and ALL 413,386 rows in
-- wfm_roster_assignment have generation_run_id NULL. So that INSERT could never succeed for any
-- assignment that exists, and every manager action returned 500. Reproduced end to end: an
-- employee rejects a day, the assignment correctly moves to 'pending_manager_action' and appears
-- in the manager queue, and then no action can clear it — the cycle is stuck permanently.
--
-- Nullable rather than dropping the FK or skipping the audit: a manager decision on a manually
-- built roster is exactly the kind of state change CLAUDE.md rule 8 requires to be auditable, so
-- the row must still be written. MySQL allows NULL in a foreign key column; every non-NULL value
-- stays constrained by fk_rda_run exactly as before.
--
-- Safe: verified live, roster_decision_audit holds 0 rows, so no existing row changes meaning and
-- there is nothing to backfill. Purely a nullability relaxation — no DROP, no DELETE, no UPDATE.
-- Guarded on information_schema so re-running is a no-op (MySQL 8 has no MODIFY COLUMN IF EXISTS,
-- and an unguarded MODIFY would be recorded as applied while doing nothing on a second run).

USE mas_hrms;

SET @needs_change := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = 'mas_hrms'
     AND TABLE_NAME = 'roster_decision_audit'
     AND COLUMN_NAME = 'run_id'
     AND IS_NULLABLE = 'NO'
);

SET @sql := IF(@needs_change > 0,
  'ALTER TABLE roster_decision_audit MODIFY COLUMN run_id VARCHAR(36) NULL',
  'SELECT ''roster_decision_audit.run_id already nullable — no change'' AS note');

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT '1513_roster_decision_audit_run_nullable.sql applied successfully' AS migration_status;
