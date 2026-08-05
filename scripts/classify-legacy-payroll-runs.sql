-- classify-legacy-payroll-runs.sql
--
-- Marks the imported payroll history as run_kind = 'legacy_import', leaving the
-- runs this HRMS actually created as 'regular'.
--
-- WHY
-- No payroll has been run or disbursed from this system yet: every salary_prep_run
-- row is imported history from the previous one. Confirmed on the live database,
-- 2026-08-05:
--
--   * 0 of 66 runs have disbursed_at set
--   * salary_run_disbursal is empty
--   * 51 FINALIZED runs (2021-03 through 2026-04) have created_by NULL — a bulk
--     import signature, and 2021 predates this HRMS entirely
--   * 12 'approved' runs carry created_by = 00000000-0000-0000-0000-000000000001,
--     a sentinel rather than a real user
--   * only 3 runs were created by this system: two 'processing' by the cron
--     ('system', 2026-06 and 2026-07) and one 'draft' by emp-finance-001 (2026-05)
--
-- Every run is currently run_kind = 'regular', which is the migration 1039 backfill
-- default and says nothing. Leaving it that way means the imported history is
-- indistinguishable from payroll this system produced — which is what made the two
-- 2026-03 runs look like a duplicate rather than two import batches.
--
-- WHAT THIS DOES NOT DO
-- It does NOT apply the uniqueness constraint in
-- scripts/payroll-run-scope-uniqueness.sql. Both 2026-03 runs are legacy, from two
-- different import batches, so after this they still share (month, scope, kind) and
-- the constraint would still reject them. That is the honest state: the constraint
-- exists to protect real runs, and there are not any yet. Apply it once this system
-- has produced runs that can be told apart — and see that file's own notes.
--
-- Reversible. Every affected row is currently 'regular'; the rollback at the bottom
-- restores exactly that, and the WHERE clause is the same one used to select them.
--
-- NOT EXECUTED AUTOMATICALLY. Review, then run against the target schema.

USE mas_hrms;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 0 — Preview. Confirm these counts before running Step 1.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT 'Step 0: runs that WILL be reclassified' AS status;
SELECT status,
       COUNT(*)                                   AS runs,
       MIN(run_month)                             AS first_month,
       MAX(run_month)                             AS last_month,
       COALESCE(created_by, '(null)')             AS created_by
  FROM salary_prep_run
 WHERE disbursed_at IS NULL
   AND (created_by IS NULL OR created_by = '00000000-0000-0000-0000-000000000001')
   AND run_kind = 'regular'
 GROUP BY status, created_by;
-- EXPECT: FINALIZED 51 (created_by null), approved 12 (created_by 0000…0001) = 63.

SELECT 'Step 0: runs that will be LEFT ALONE' AS status;
SELECT run_month, status, COALESCE(created_by, '(null)') AS created_by, disbursed_at
  FROM salary_prep_run
 WHERE NOT (disbursed_at IS NULL
            AND (created_by IS NULL OR created_by = '00000000-0000-0000-0000-000000000001'));
-- EXPECT 3 rows: 2026-06 processing/system, 2026-07 processing/system,
--                2026-05 draft/emp-finance-001.

SELECT 'Step 0: nothing has ever been disbursed' AS status;
SELECT (SELECT COUNT(*) FROM salary_prep_run WHERE disbursed_at IS NOT NULL) AS runs_disbursed,
       (SELECT COUNT(*) FROM salary_run_disbursal)                           AS disbursal_rows;
-- EXPECT 0 and 0. If either is non-zero, STOP: this system has paid someone and the
-- premise of this script no longer holds.

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 1 — Reclassify.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE salary_prep_run
   SET run_kind = 'legacy_import'
 WHERE disbursed_at IS NULL
   AND (created_by IS NULL OR created_by = '00000000-0000-0000-0000-000000000001')
   AND run_kind = 'regular';
-- EXPECT exactly 63 rows affected. If the count differs, ROLL BACK and re-check
-- Step 0 — the population has moved since this was written.

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 2 — Verify.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT 'Step 2: distribution after' AS status;
SELECT run_kind, status, COUNT(*) AS runs
  FROM salary_prep_run
 GROUP BY run_kind, status
 ORDER BY run_kind, runs DESC;
-- EXPECT legacy_import: FINALIZED 51, approved 12
--        regular:       processing 2, draft 1

SELECT 'Step 2: 2026-03 still holds two runs of the same kind' AS status;
SELECT run_month, run_kind, COUNT(*) AS runs
  FROM salary_prep_run
 GROUP BY run_month, run_kind
HAVING COUNT(*) > 1;
-- EXPECT one row: 2026-03 / legacy_import / 2. This is expected and is why the
-- uniqueness constraint is NOT applied here — see the header.

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback
-- ─────────────────────────────────────────────────────────────────────────────
-- UPDATE salary_prep_run
--    SET run_kind = 'regular'
--  WHERE disbursed_at IS NULL
--    AND (created_by IS NULL OR created_by = '00000000-0000-0000-0000-000000000001')
--    AND run_kind = 'legacy_import';
