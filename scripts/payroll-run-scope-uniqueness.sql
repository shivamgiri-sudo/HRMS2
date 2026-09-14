-- payroll-run-scope-uniqueness.sql
--
-- Run AFTER scripts/purge-synthetic-payroll-run.sql. Deliberately NOT a migration:
-- it fails by design while duplicates exist, and MIGRATION_MANIFEST stops the whole
-- runner on first failure, so manifesting it would block every deploy.
--
-- Makes duplicate payroll runs impossible at the database level.
--
-- THE HOLE
-- salary_prep_run already carries UNIQUE (run_month, branch_filter, process_filter),
-- and payroll.service.ts checks for an existing run before inserting. Both look
-- sufficient and neither is:
--
--   * The application check (payroll.service.ts, "Payroll run already exists for
--     this month") only protects inserts that go through the application. Anything
--     inserted by raw SQL — a script, a console, a migration — walks straight past it.
--   * The UNIQUE index does not fire for the only shape that occurs in practice.
--     branch_filter and process_filter are both nullable varchar(255), and SQL
--     treats NULL as distinct from NULL, so any number of rows with (month, NULL,
--     NULL) satisfy the constraint. All 67 production runs have both columns NULL.
--
-- So the constraint has never once prevented a duplicate. Verified on prod
-- 31-Jul-2026, two months hold two full-company runs each:
--
--   2026-07  93ff8899… 'system'          1,467 payslip lines   <- real
--            e17386a3… 'test-auto-gen'   1,288 payslip lines   <- synthetic, UUID v1
--   2026-03  5469fa7d… approved, 263 employees
--            3ebd0ab6… FINALIZED, 0 employees
--
-- This is not cosmetic. payroll-targeted-recalculation.service.ts has to update
-- EVERY run an employee has a line in precisely because duplicates exist; when it
-- updated only the newest, 1,288 employees kept stale salary values in the other
-- run, which is what the salary_payable_days_mismatch reconciliation issues were
-- made of. The CEO UAT of 31-Jul-2026 saw the same duplicates surfaced as "Jul 2026
-- - processing" appearing twice on the payslip screen.
--
-- THE FIX
-- Two STORED generated columns fold NULL into a sentinel, and the unique index is
-- built on those. NULL and NULL then collide as they should, and no insert path —
-- application, script or console — can create a second run for the same scope.
--
-- ORDERING — THIS MIGRATION WILL FAIL UNTIL THE EXISTING DUPLICATES ARE RESOLVED.
-- That is deliberate: it refuses to run rather than silently skipping the index and
-- leaving everyone believing the table is protected. Resolve first:
--   1. 2026-07 — run scripts/purge-synthetic-payroll-run.sql (archives, then deletes
--      the test-auto-gen run and its 1,288 lines).
--   2. 2026-03 — needs a payroll decision, not a script. One run is FINALIZED with 0
--      employees, the other approved with 263. Neither is obviously disposable;
--      whoever owns payroll must say which is authoritative.
-- Step 0 below reports exactly what is blocking, so a failed run is self-explaining.
--
-- Additive. Adds two derived columns and one index. Changes no existing column, no
-- row, and no payroll figure. Both generated columns are STORED rather than VIRTUAL
-- because a unique index over a VIRTUAL column cannot be used the same way.
--
-- NOT EXECUTED AUTOMATICALLY. Review, then run against the target schema.

USE mas_hrms;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 0 — Preconditions. If this returns rows, STOP: the index cannot be created.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT 'Step 0: duplicate scopes blocking the unique index' AS status;
SELECT run_month,
       COALESCE(branch_filter,  '~ALL~') AS branch_scope,
       COALESCE(process_filter, '~ALL~') AS process_scope,
       run_kind,
       COUNT(*)                          AS runs,
       GROUP_CONCAT(id ORDER BY created_at)         AS run_ids,
       GROUP_CONCAT(COALESCE(created_by, 'NULL') ORDER BY created_at) AS created_by
  FROM salary_prep_run
 GROUP BY run_month, branch_scope, process_scope, run_kind
HAVING COUNT(*) > 1;
-- EXPECT zero rows before proceeding.
--
-- History of the blockers:
--   2026-07  cleared 2026-07-31. A true duplicate — the test-auto-gen run's 1,288
--            employees were a perfect subset of the real run's 1,467 — purged and
--            archived by scripts/purge-synthetic-payroll-run.sql.
--   2026-03  NOT a duplicate. Two disjoint populations, zero employee overlap: the
--            operational run (1,140 lines) and a legacy import (226 lines, 76% inactive
--            staff, branches that exist in no other run). Resolved by run_kind rather
--            than by deleting either — requires 1039_salary_prep_run_kind.sql applied
--            AND the legacy run classified. See that file for the evidence.
--
-- This grouping includes run_kind, so a month may hold one run of each kind.

SELECT 'Step 0b: run_kind must exist before the key can reference it' AS status;
SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'salary_prep_run'
      AND COLUMN_NAME = 'run_kind') = 0,
  'STOP: apply backend/sql/1039_salary_prep_run_kind.sql first',
  'OK: run_kind present') AS precondition;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 1 — Derived scope columns. Guarded so the migration is re-runnable.
-- ─────────────────────────────────────────────────────────────────────────────
SET @schema := DATABASE();

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = 'salary_prep_run'
      AND COLUMN_NAME = 'branch_scope_key') = 0,
  'ALTER TABLE salary_prep_run
     ADD COLUMN branch_scope_key VARCHAR(255)
       GENERATED ALWAYS AS (COALESCE(branch_filter, ''~ALL~'')) STORED
       COMMENT ''NULL-folded branch_filter; exists so the scope unique index fires''',
  'SELECT ''branch_scope_key already present'''));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = 'salary_prep_run'
      AND COLUMN_NAME = 'process_scope_key') = 0,
  'ALTER TABLE salary_prep_run
     ADD COLUMN process_scope_key VARCHAR(255)
       GENERATED ALWAYS AS (COALESCE(process_filter, ''~ALL~'')) STORED
       COMMENT ''NULL-folded process_filter; exists so the scope unique index fires''',
  'SELECT ''process_scope_key already present'''));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 2 — The constraint that actually holds.
-- ─────────────────────────────────────────────────────────────────────────────
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = 'salary_prep_run'
      AND INDEX_NAME = 'uq_spr_month_scope') = 0,
  'CREATE UNIQUE INDEX uq_spr_month_scope
     ON salary_prep_run (run_month, branch_scope_key, process_scope_key, run_kind)',
  'SELECT ''uq_spr_month_scope already present'''));
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- The original uq_run_month_branch_process is deliberately LEFT IN PLACE. It is
-- harmless, it still catches the non-NULL case, and dropping a constraint is not
-- something this migration needs to do to achieve its purpose.

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 3 — Verify.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT 'Step 3: index present' AS status;
SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols, NON_UNIQUE
  FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = 'salary_prep_run'
   AND INDEX_NAME = 'uq_spr_month_scope'
 GROUP BY INDEX_NAME, NON_UNIQUE;
-- EXPECT one row: run_month,branch_scope_key,process_scope_key,run_kind with NON_UNIQUE = 0.

SELECT 'Step 3: still one run per scope' AS status;
-- Must group by the SAME four columns the index is built on. This previously grouped
-- by three, omitting run_kind, so it counted the legitimate 2026-03 pair — one
-- operational run and one legacy import, zero employee overlap — as a duplicate
-- scope. A successful run would have reported itself failed at the final step, on a
-- production schema change, which is the worst possible moment for a false alarm.
SELECT COUNT(*) AS duplicate_scopes FROM (
  SELECT run_month, branch_scope_key, process_scope_key, run_kind
    FROM salary_prep_run
   GROUP BY run_month, branch_scope_key, process_scope_key, run_kind
  HAVING COUNT(*) > 1
) d;
-- EXPECT 0.

-- Rollback:
--   DROP INDEX uq_spr_month_scope ON salary_prep_run;
--   ALTER TABLE salary_prep_run DROP COLUMN process_scope_key, DROP COLUMN branch_scope_key;
