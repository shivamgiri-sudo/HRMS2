-- classify-test-data.sql
--
-- NOT EXECUTED. Requires migration 1063 to have been applied first.
--
-- Replaces scripts/purge-test-data-from-masters.sql, which deleted rows. Nothing here
-- deletes anything. Every statement sets a flag, and every statement is reversible with a
-- single UPDATE.
--
-- WHY THE DELETE APPROACH WAS ABANDONED
--
--   ats_candidate     26 inbound foreign keys, 25 ON DELETE CASCADE
--   employees        158 inbound foreign keys, 118 ON DELETE CASCADE
--   process_master    38 inbound foreign keys
--
-- One DELETE from ats_candidate silently removes rows from twenty-five other tables,
-- including interview records and audit trails, with no dry-run and no way to see the blast
-- radius from the statement. And ats_candidate is not a scratch table — most of its rows are
-- employee records, not applicants, so "these are only candidates" was never true.
--
-- The CODEX employees are not inert either: between them they carry 160 attendance records,
-- 4 salary_prep_line rows and 86 KPI actuals. Those payroll lines sit inside finalised runs.
-- Deleting the employees would change the totals of a payroll that has already been signed
-- off, which is a bigger problem than the one being solved.
--
-- And deleting hides the actual defect. A test candidate reached rank 2 of the live Quality
-- leaderboard at 96.67% "Excellent" in front of the CEO. That is a reporting bug — the
-- leaderboard has no notion of test data — and removing the row makes the symptom go away
-- while leaving the next seeded record free to do the same thing.
--
-- Safe to re-run: every UPDATE is idempotent and re-asserts the same value.

USE mas_hrms;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 0 — What will be classified. Read this before running anything below.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT 'Step 0a: candidates to mark' AS report;
SELECT id, candidate_name, mobile, email, current_stage, is_test_data
  FROM ats_candidate
 WHERE candidate_name LIKE 'CODEX_E2E%'
    OR candidate_name LIKE 'TEST DEMO%'
    OR email LIKE '%@codex-e2e.invalid';

SELECT 'Step 0b: employees to mark' AS report;
SELECT e.id, e.employee_code, e.full_name, e.active_status, e.is_test_data,
       (SELECT COUNT(*) FROM attendance_daily_record a WHERE a.employee_id = e.id) AS attendance_rows,
       (SELECT COUNT(*) FROM salary_prep_line s WHERE s.employee_id = e.id)        AS payroll_lines,
       (SELECT COUNT(*) FROM kpi_daily_actual k WHERE k.employee_id = e.id)        AS kpi_actuals
  FROM employees e
 WHERE e.full_name LIKE 'CODEX%'
    OR e.employee_code LIKE 'CODEX%';

SELECT 'Step 0c: processes to mark' AS report;
SELECT p.id, p.process_name, p.active_status, p.is_test_data,
       (SELECT COUNT(*) FROM employees e WHERE e.process_id = p.id) AS employees_attached
  FROM process_master p
 WHERE p.process_name LIKE 'TEST DEMO%'
    OR p.process_name LIKE 'CODEX%';

-- A process with employees attached is NOT test data, whatever it is called. Marking it
-- would hide real people from every process-scoped report. Step 2 refuses to mark those and
-- this query is how you see them before running it.
SELECT 'Step 0d: named like test data BUT carrying real employees — will NOT be marked' AS report;
SELECT p.id, p.process_name,
       (SELECT COUNT(*) FROM employees e WHERE e.process_id = p.id) AS employees_attached
  FROM process_master p
 WHERE (p.process_name LIKE 'TEST DEMO%' OR p.process_name LIKE 'CODEX%')
   AND (SELECT COUNT(*) FROM employees e WHERE e.process_id = p.id) > 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 1 — Candidates
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE ats_candidate
   SET is_test_data        = 1,
       test_data_reason    = 'Seeded by CODEX end-to-end suite; flagged in CEO UAT Round 1 and 2',
       test_data_marked_at = NOW()
 WHERE (candidate_name LIKE 'CODEX_E2E%'
     OR candidate_name LIKE 'TEST DEMO%'
     OR email LIKE '%@codex-e2e.invalid')
   AND is_test_data = 0;

SELECT 'Step 1: candidates marked' AS report, ROW_COUNT() AS rows_affected;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 2 — Employees. Marked AND deactivated; never deleted, because their payroll
-- lines sit inside finalised runs.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE employees
   SET is_test_data        = 1,
       test_data_reason    = 'CODEX synthetic employee; retains attendance/payroll/KPI history',
       test_data_marked_at = NOW(),
       active_status       = 0
 WHERE (full_name LIKE 'CODEX%' OR employee_code LIKE 'CODEX%')
   AND is_test_data = 0;

SELECT 'Step 2: employees marked and deactivated' AS report, ROW_COUNT() AS rows_affected;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 3 — Processes, but only those with nobody attached. The name is a hint, the
-- headcount is the evidence.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE process_master p
   SET p.is_test_data        = 1,
       p.test_data_reason    = 'Demo process with zero employees attached',
       p.test_data_marked_at = NOW()
 WHERE (p.process_name LIKE 'TEST DEMO%' OR p.process_name LIKE 'CODEX%')
   AND p.is_test_data = 0
   AND NOT EXISTS (SELECT 1 FROM employees e WHERE e.process_id = p.id);

SELECT 'Step 3: processes marked' AS report, ROW_COUNT() AS rows_affected;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 4 — Verify
-- ─────────────────────────────────────────────────────────────────────────────
SELECT 'Step 4: totals' AS report;
SELECT 'ats_candidate'  AS tbl, COUNT(*) AS marked FROM ats_candidate  WHERE is_test_data = 1
UNION ALL
SELECT 'employees',            COUNT(*)            FROM employees      WHERE is_test_data = 1
UNION ALL
SELECT 'process_master',       COUNT(*)            FROM process_master WHERE is_test_data = 1;

-- The check that matters. If this returns rows, the flag is set but the leaderboard still
-- shows them, which is the situation the flag exists to prevent.
SELECT 'Step 4b: marked candidates still visible to the Quality leaderboard' AS report;
SELECT COUNT(*) AS still_visible
  FROM ats_candidate
 WHERE is_test_data = 1;
-- Compare against what /api/quality/leaderboard returns. Non-zero here is expected until
-- the exclusion predicate is applied at every site listed in
-- backend/src/shared/testDataExclusion.ts — marking without excluding changes nothing.

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback
-- ─────────────────────────────────────────────────────────────────────────────
-- UPDATE ats_candidate  SET is_test_data = 0, test_data_reason = NULL, test_data_marked_at = NULL WHERE is_test_data = 1;
-- UPDATE process_master SET is_test_data = 0, test_data_reason = NULL, test_data_marked_at = NULL WHERE is_test_data = 1;
-- Employees also had active_status set to 0. Reversing that is a separate decision — the
-- rollback below restores the flag only, deliberately leaving them deactivated:
-- UPDATE employees      SET is_test_data = 0, test_data_reason = NULL, test_data_marked_at = NULL WHERE is_test_data = 1;
