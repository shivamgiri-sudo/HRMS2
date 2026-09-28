-- Migration 1906: Attendance data fixes (issues 2, 6, 7 from 2026-09-28 review)
--
-- Issue 2:  MAS62122 mapped to cost_centre 961 (Neeman's) but process_name shows Bellavita.
-- Issue 7:  MAS62918, MAS62921, MAS63343, MAS63085, MAS62917 — process_name doesn't match
--           their cost_centre.
-- Fix:      For these employees, derive the correct process_id from their own cost_centre_master
--           row. The cost_centre is the authoritative source per 1897 org-mapping upload design.
--
-- Issue 6a: MAS07279 (Parveen) should be marked Present when login = 8h45m (525 minutes).
--           Default full_day threshold is 540; needs an exception bucket row.
-- Issue 6b: MAS01963 (Sudeep Negi) — one punch should count as Present per existing
--           singlePunchCountsAsPresent logic (extended 2026-09-03 owner ruling).
-- Fix:      Insert/update employee_attendance_exception_bucket for both employees.
--
-- All changes are guarded / idempotent.
-- Row-level UPDATEs only — no DDL. Uses extended lock timeout so concurrent
-- backend transactions (attendance import, payroll) don't block this.

SET SESSION innodb_lock_wait_timeout = 300;
SET SESSION lock_wait_timeout        = 300;

SET @db = DATABASE();

-- ─── Issues 2 & 7: fix process_id to match cost_centre ──────────────────────
-- Update process_id for each affected employee from their own cost_centre_master.
-- Uses employee_code to avoid hardcoding UUIDs; skips if cost_centre_id is NULL
-- or the cost_centre has no process_id (leaves it unchanged).

UPDATE employees e
  JOIN cost_centre_master ccm ON ccm.id = e.cost_centre_id
SET e.process_id = ccm.process_id
WHERE e.employee_code IN (
  'MAS62122',
  'MAS62918',
  'MAS62921',
  'MAS63343',
  'MAS63085',
  'MAS62917'
)
AND ccm.process_id IS NOT NULL
AND (e.process_id IS NULL OR e.process_id != ccm.process_id);

-- ─── Issue 6a: MAS07279 — full day at 525 minutes (8h45m) ────────────────────
INSERT INTO employee_attendance_exception_bucket
  (id, employee_id, single_punch_counts_as_present, full_day_threshold_minutes, reason, active_status, created_by)
SELECT
  UUID(),
  e.id,
  0,           -- single punch NOT special for this employee; only threshold differs
  525,         -- 8h45m = present (default is 540)
  'Owner ruling 2026-09-28: MAS07279 Parveen — full-day threshold corrected to 525 min (8h45m)',
  1,
  '00000000-0000-0000-0000-000000000001'  -- system/migration actor UUID
FROM employees e
WHERE e.employee_code = 'MAS07279'
  AND NOT EXISTS (
    SELECT 1 FROM employee_attendance_exception_bucket x
     WHERE x.employee_id = e.id AND x.active_status = 1
  );

-- If a bucket row already exists for MAS07279, update threshold only
UPDATE employee_attendance_exception_bucket eaeb
  JOIN employees e ON e.id = eaeb.employee_id
SET eaeb.full_day_threshold_minutes = 525,
    eaeb.reason = 'Owner ruling 2026-09-28: MAS07279 Parveen — full-day threshold corrected to 525 min (8h45m)'
WHERE e.employee_code = 'MAS07279'
  AND eaeb.active_status = 1
  AND eaeb.full_day_threshold_minutes != 525;

-- ─── Issue 6b: MAS01963 — single punch counts as Present ─────────────────────
INSERT INTO employee_attendance_exception_bucket
  (id, employee_id, single_punch_counts_as_present, full_day_threshold_minutes, reason, active_status, created_by)
SELECT
  UUID(),
  e.id,
  1,    -- any punch on the day = present, per owner ruling extended 2026-09-03
  NULL, -- use default full_day threshold
  'Owner ruling 2026-09-28: MAS01963 Sudeep Negi — single punch counts as present (SR. MANAGER role confirmed)',
  1,
  '00000000-0000-0000-0000-000000000001'  -- system/migration actor UUID
FROM employees e
WHERE e.employee_code = 'MAS01963'
  AND NOT EXISTS (
    SELECT 1 FROM employee_attendance_exception_bucket x
     WHERE x.employee_id = e.id AND x.active_status = 1
  );

-- If row already exists for MAS01963, ensure flag is set
UPDATE employee_attendance_exception_bucket eaeb
  JOIN employees e ON e.id = eaeb.employee_id
SET eaeb.single_punch_counts_as_present = 1,
    eaeb.reason = 'Owner ruling 2026-09-28: MAS01963 Sudeep Negi — single punch counts as present'
WHERE e.employee_code = 'MAS01963'
  AND eaeb.active_status = 1
  AND eaeb.single_punch_counts_as_present != 1;

-- ─── Issue 1: MAS52717 left Aug-2023 — ensure date_of_leaving is set ─────────
-- If still NULL (employee left in iSpark/COSEC but DOL was never recorded in HRMS),
-- set date_of_leaving to the last day of Aug 2023 as a safe conservative default.
-- attendance-source-sheet.service.ts already blanks post-DOL days once this is set.
UPDATE employees
SET date_of_leaving = COALESCE(date_of_leaving, '2023-08-31'),
    employment_status = IF(employment_status IN ('Active','active'), 'Inactive', employment_status),
    active_status = 0
WHERE employee_code = 'MAS52717'
  AND (date_of_leaving IS NULL OR employment_status IN ('Active','active'));
