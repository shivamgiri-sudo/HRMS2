-- purge-test-data-from-masters.sql
--
-- NOT EXECUTED. Run Step 0 first, read the output, then decide.
--
-- Test records were flagged in CEO UAT Round 1 (31-Jul) and again in Round 2 (01-Aug),
-- where the CEO noted the test candidate had *risen* to rank 2 of the live Quality
-- leaderboard at 96.67% "Excellent".
--
-- The four categories are NOT equivalent and this script deliberately treats them
-- differently. Investigating them against production produced two findings that change what
-- is safe to do:
--
--   1. The CODEX employees are not inert. Between them they carry 160 attendance records,
--      4 salary_prep_line rows and 86 KPI actuals. Those payroll lines sit inside real runs,
--      so DELETING these employees would silently change the totals of a finalised payroll.
--      They are deactivated and marked, not deleted.
--
--   2. The "duplicate BSS-OTHERS" is not a duplicate that can be purged. Both rows carry
--      real employees — 15 on BSS_OTHERS and 179 on BSSOTHERS. Deleting either orphans
--      those people. This needs a merge decision from an owner and is out of scope here;
--      Step 0 reports it so it is not quietly forgotten.
--
-- Safe to re-run. Every delete is double-keyed on the id AND the test marker, so a mistyped
-- id cannot remove a real row.

USE mas_hrms;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 0 — Report. Read this before running anything below it.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT 'Step 0.1: candidates to be deleted' AS report;
SELECT id, full_name, created_at
  FROM ats_candidate
 WHERE full_name LIKE '%CODEX\_E2E%' ESCAPE '\\'
 ORDER BY created_at;

SELECT 'Step 0.2: employees to be DEACTIVATED, not deleted — they carry live records' AS report;
SELECT e.id, e.employee_code, e.full_name, e.active_status,
       (SELECT COUNT(*) FROM attendance_daily_record a WHERE a.employee_id = e.id) AS attendance_rows,
       (SELECT COUNT(*) FROM salary_prep_line l      WHERE l.employee_id = e.id) AS payroll_lines,
       (SELECT COUNT(*) FROM kpi_daily_actual k      WHERE k.employee_id = e.id) AS kpi_rows
  FROM employees e
 WHERE e.full_name LIKE '%CODEX\_E2E%' ESCAPE '\\'
 ORDER BY e.employee_code;

SELECT 'Step 0.3: processes to be retired — must have zero employees attached' AS report;
SELECT p.id, p.process_code, p.process_name, p.active_status,
       (SELECT COUNT(*) FROM employees e WHERE e.process_id = p.id) AS employees_attached
  FROM process_master p
 WHERE p.process_name LIKE 'TEST DEMO%'
 ORDER BY p.process_name;

SELECT 'Step 0.4: NOT HANDLED HERE — duplicate BSS-OTHERS needs a merge decision' AS report;
SELECT p.id, p.process_code, p.process_name,
       (SELECT COUNT(*) FROM employees e WHERE e.process_id = p.id) AS employees_attached
  FROM process_master p
 WHERE p.process_name = 'BSS-OTHERS'
 ORDER BY employees_attached DESC;
-- Both rows carry real employees. Pick a survivor, repoint the other's employees to it,
-- then retire the loser. That is a data-ownership decision, not a purge.

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 1 — Archive. Nothing is removed before it is copied.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ats_candidate_testpurge_20260801 AS
  SELECT * FROM ats_candidate WHERE full_name LIKE '%CODEX\_E2E%' ESCAPE '\\';

CREATE TABLE IF NOT EXISTS employees_testpurge_20260801 AS
  SELECT * FROM employees WHERE full_name LIKE '%CODEX\_E2E%' ESCAPE '\\';

CREATE TABLE IF NOT EXISTS process_master_testpurge_20260801 AS
  SELECT * FROM process_master WHERE process_name LIKE 'TEST DEMO%';

SELECT 'Step 1: archived row counts' AS report;
SELECT
  (SELECT COUNT(*) FROM ats_candidate_testpurge_20260801)  AS candidates_archived,
  (SELECT COUNT(*) FROM employees_testpurge_20260801)      AS employees_archived,
  (SELECT COUNT(*) FROM process_master_testpurge_20260801) AS processes_archived;

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 2 — Candidates. Safe to delete; nothing downstream depends on them.
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM ats_candidate
 WHERE full_name LIKE '%CODEX\_E2E%' ESCAPE '\\'
   AND id IN (SELECT id FROM ats_candidate_testpurge_20260801);

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 3 — Employees. DEACTIVATED, not deleted.
--
-- Deleting them would cascade into attendance and, more seriously, into salary_prep_line
-- rows that belong to real payroll runs — changing the totals of a payroll that has already
-- been finalised. Deactivating removes them from every leaderboard, dashboard and report
-- that filters on active_status, which is the outcome the CEO actually asked for, without
-- rewriting payroll history.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE employees
   SET active_status = 0,
       employment_status = 'inactive'
 WHERE full_name LIKE '%CODEX\_E2E%' ESCAPE '\\'
   AND id IN (SELECT id FROM employees_testpurge_20260801);

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 4 — Processes. Only those with zero employees attached.
-- The subquery guard means a process that has acquired employees since Step 0 is skipped
-- rather than deleted.
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM process_master
 WHERE process_name LIKE 'TEST DEMO%'
   AND id IN (SELECT id FROM process_master_testpurge_20260801)
   AND NOT EXISTS (SELECT 1 FROM employees e WHERE e.process_id = process_master.id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 5 — Verify
-- ─────────────────────────────────────────────────────────────────────────────
SELECT 'Step 5: after' AS report;
SELECT
  (SELECT COUNT(*) FROM ats_candidate WHERE full_name LIKE '%CODEX\_E2E%' ESCAPE '\\')            AS candidates_left,
  (SELECT COUNT(*) FROM employees WHERE full_name LIKE '%CODEX\_E2E%' ESCAPE '\\' AND active_status = 1) AS active_test_employees_left,
  (SELECT COUNT(*) FROM process_master WHERE process_name LIKE 'TEST DEMO%')                      AS test_processes_left;
-- EXPECT: 0, 0, 0.

-- The quality leaderboard reads db_audit.call_quality_assessment, a separate upstream
-- database this script does not touch. Deactivating the employee removes them from any
-- surface that joins to employees and filters on active_status. Confirm the leaderboard
-- specifically after running — if it still shows the test agent, that surface is reading
-- the audit table without an employee join and needs its own fix.
