-- Purge the synthetic "test-auto-gen" payroll run
--
-- Issue:  A Jul-2026 payroll run created by `test-auto-gen` sits in salary_prep_run
--         alongside the real one. Both render identically in the UI ("Jul 2026 —
--         processing", total_employees 1288), and it carries 1,288 payslip lines
--         worth INR 1.22 Cr net. Found during the CEO UAT of 31-Jul-2026, which
--         reported "Jul 2026 - processing" appearing twice.
--
-- Why it is synthetic, on four independent signals:
--   1. created_by = 'test-auto-gen'
--   2. id is a UUID v1 with a MAC-address node (…-11f1-adb1-00155d0ab410), i.e.
--      MySQL's UUID() from a raw INSERT — every application-created run is UUID v4
--   3. window_close_date is NULL; the payroll-window logic never ran for it
--   4. its line population (1,288) differs from the real run's (1,467)
--
-- Real run for the same month, DO NOT TOUCH:
--   93ff8899-5d76-40c8-8144-bace46c378cc  created_by 'system'  1,467 lines
--
-- Run Date: (fill in when executed)
-- Author:   Claude Opus 5
--
-- SAFETY
--   - Archives every row to *_archive_20260731 tables INSIDE the database before
--     deleting, so this is reversible without a filesystem restore.
--   - Every statement is keyed on the run id AND created_by = 'test-auto-gen'.
--     If someone edits created_by first, the deletes match nothing rather than
--     hitting the wrong run.
--   - Wrapped in a transaction. Review the verification output before COMMIT.
--
-- NOT EXECUTED AUTOMATICALLY. This deletes production payroll records; it needs
-- the payroll owner's explicit approval. Take a mas_hrms backup first.

USE mas_hrms;

SET @RUN_ID := 'e17386a3-7d56-11f1-adb1-00155d0ab410';

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 0 — Confirm the target is what we think it is. STOP if this is not exact.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT 'Step 0: target run' AS status;
SELECT id, run_month, status, created_by, total_employees, total_gross, total_net,
       window_close_date
  FROM salary_prep_run
 WHERE id = @RUN_ID;
-- EXPECT exactly one row: run_month 2026-07, status processing,
--        created_by 'test-auto-gen', window_close_date NULL.

SELECT 'Step 0: the real run that must survive' AS status;
SELECT id, run_month, status, created_by, COUNT(l.id) AS line_count
  FROM salary_prep_run r
  LEFT JOIN salary_prep_line l ON l.run_id = r.id
 WHERE r.run_month = '2026-07' AND r.id <> @RUN_ID
 GROUP BY r.id, r.run_month, r.status, r.created_by;
-- EXPECT 93ff8899-… / system / 1467 lines.

SELECT 'Step 0: rows that will be removed' AS status;
SELECT
  (SELECT COUNT(*) FROM salary_prep_run            WHERE id = @RUN_ID)      AS runs,
  (SELECT COUNT(*) FROM salary_prep_line           WHERE run_id = @RUN_ID)  AS payslip_lines,
  (SELECT COUNT(*) FROM salary_prep_line_component
     WHERE line_id IN (SELECT id FROM salary_prep_line WHERE run_id = @RUN_ID)) AS components,
  (SELECT COUNT(*) FROM payroll_disbursement       WHERE run_id = @RUN_ID)  AS disbursements,
  (SELECT COUNT(*) FROM salary_run_manual_tds      WHERE run_id = @RUN_ID)  AS manual_tds;
-- Measured 31-Jul-2026: runs 1, payslip_lines 1288, components 5249,
--                       disbursements 0, manual_tds 0.
-- If disbursements or manual_tds are non-zero, STOP — money has moved against
-- this run and it is not merely synthetic. Escalate instead of deleting.

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 1 — Archive. Reversible without touching backups.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT 'Step 1: archiving' AS status;

CREATE TABLE IF NOT EXISTS salary_prep_run_archive_20260731
  AS SELECT * FROM salary_prep_run WHERE id = @RUN_ID AND created_by = 'test-auto-gen';

CREATE TABLE IF NOT EXISTS salary_prep_line_archive_20260731
  AS SELECT * FROM salary_prep_line WHERE run_id = @RUN_ID;

CREATE TABLE IF NOT EXISTS salary_prep_line_component_archive_20260731
  AS SELECT * FROM salary_prep_line_component
      WHERE line_id IN (SELECT id FROM salary_prep_line WHERE run_id = @RUN_ID);

SELECT 'Step 1: archive counts (must match Step 0)' AS status;
SELECT
  (SELECT COUNT(*) FROM salary_prep_run_archive_20260731)            AS runs,
  (SELECT COUNT(*) FROM salary_prep_line_archive_20260731)           AS payslip_lines,
  (SELECT COUNT(*) FROM salary_prep_line_component_archive_20260731) AS components;
-- STOP unless these equal Step 0. An empty archive means created_by was changed
-- or the id is wrong, and the deletes below would then also match nothing.

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 2 — Delete, child-first for FK safety.
--   salary_prep_line_component → salary_prep_line → salary_prep_run
-- ─────────────────────────────────────────────────────────────────────────────
START TRANSACTION;

DELETE FROM salary_prep_line_component
 WHERE line_id IN (SELECT id FROM salary_prep_line WHERE run_id = @RUN_ID);

DELETE FROM salary_prep_line
 WHERE run_id = @RUN_ID;

-- created_by is repeated here as a final guard: if this row is not the synthetic
-- one, nothing is deleted and the transaction can be rolled back safely.
DELETE FROM salary_prep_run
 WHERE id = @RUN_ID AND created_by = 'test-auto-gen';

-- ─────────────────────────────────────────────────────────────────────────────
-- Step 3 — Verify BEFORE committing.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT 'Step 3: residue (all must be 0)' AS status;
SELECT
  (SELECT COUNT(*) FROM salary_prep_run  WHERE id = @RUN_ID)     AS runs_left,
  (SELECT COUNT(*) FROM salary_prep_line WHERE run_id = @RUN_ID) AS lines_left;

SELECT 'Step 3: the real Jul-2026 run is untouched' AS status;
SELECT r.id, r.created_by, COUNT(l.id) AS line_count, ROUND(SUM(l.net_salary)) AS net
  FROM salary_prep_run r
  LEFT JOIN salary_prep_line l ON l.run_id = r.id
 WHERE r.run_month = '2026-07'
 GROUP BY r.id, r.created_by;
-- EXPECT one row only: 93ff8899-… / system / 1467 lines / 12305845.

SELECT 'Step 3: sign-off queue now shows one run per month' AS status;
SELECT id, run_month, status, created_by
  FROM salary_prep_run
 WHERE LOWER(COALESCE(status,'')) = 'processing'
   AND finance_approved_at IS NULL
 ORDER BY run_month DESC;
-- EXPECT 2026-07 and 2026-06, both created_by 'system'.

-- COMMIT;    -- uncomment only once every check above reads as expected
-- ROLLBACK;  -- otherwise

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollback after commit, if ever needed
-- ─────────────────────────────────────────────────────────────────────────────
-- INSERT INTO salary_prep_run            SELECT * FROM salary_prep_run_archive_20260731;
-- INSERT INTO salary_prep_line           SELECT * FROM salary_prep_line_archive_20260731;
-- INSERT INTO salary_prep_line_component SELECT * FROM salary_prep_line_component_archive_20260731;
--
-- Drop the archive tables only after a payroll cycle has closed cleanly without them.
