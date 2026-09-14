-- 1083_wfm_attendance_exceptions_page_code.sql
--
-- Gives /wfm/attendance-exceptions its own page code.
--
-- Why: the route was gated on WFM_LIVE_TRACKER, a code shared with four unrelated pages
-- (/wfm/live-tracker, /wfm/adherence-command-center, /wfm/agent-attendance-view,
-- /wfm/cosec-monitoring). That made access impossible to grant or revoke for this page
-- alone, and it locked out `payroll` — who own the `salary_payable_days_mismatch`
-- blockers (455 open) that stop a payroll run — along with `hr` and `ceo`.
--
-- Grants below = exact parity with the roles that hold WFM_LIVE_TRACKER in live
-- role_page_access today (super_admin, admin, wfm, branch_wfm, manager, process_manager,
-- branch_head), PLUS payroll, hr and ceo.
--
-- Read-only page: can_view + can_export only (the page has a CSV export and no write
-- actions). No UPDATE or DELETE anywhere in this file; it is purely additive and safe to
-- re-run.
--
-- ⚠ ORDER MATTERS. This migration MUST be applied BEFORE the frontend change that
-- repoints the route's Gate to WFM_ATTENDANCE_EXCEPTIONS, otherwise every role loses the
-- page until it is run. It was applied to live mas_hrms on 2026-08-07, ahead of any
-- deploy. (An earlier version of this note claimed prod runs SKIP_MIGRATIONS=true — that
-- is wrong: migrations do run at boot, so a pm2 restart would also apply it. The file is
-- idempotent either way.)

-- ─── Step 1: register the page ────────────────────────────────────────────────
INSERT INTO page_catalog (id, page_code, page_name, page_path, module, description, active_status)
VALUES (
  UUID(),
  'WFM_ATTENDANCE_EXCEPTIONS',
  'Attendance Exception Engine',
  '/wfm/attendance-exceptions',
  'Attendance',
  'Reconciliation and data-integrity exceptions from attendance_reconciliation_issue (read-only worklist).',
  1
)
ON DUPLICATE KEY UPDATE
  page_name     = VALUES(page_name),
  page_path     = VALUES(page_path),
  module        = VALUES(module),
  description   = VALUES(description),
  active_status = 1;

-- ─── Step 2: grant it ─────────────────────────────────────────────────────────
INSERT INTO role_page_access
  (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  ('super_admin',     'WFM_ATTENDANCE_EXCEPTIONS', 1, 0, 0, 0, 1, 1),
  ('admin',           'WFM_ATTENDANCE_EXCEPTIONS', 1, 0, 0, 0, 1, 1),
  ('wfm',             'WFM_ATTENDANCE_EXCEPTIONS', 1, 0, 0, 0, 1, 1),
  ('branch_wfm',      'WFM_ATTENDANCE_EXCEPTIONS', 1, 0, 0, 0, 1, 1),
  ('manager',         'WFM_ATTENDANCE_EXCEPTIONS', 1, 0, 0, 0, 1, 1),
  ('process_manager', 'WFM_ATTENDANCE_EXCEPTIONS', 1, 0, 0, 0, 1, 1),
  ('branch_head',     'WFM_ATTENDANCE_EXCEPTIONS', 1, 0, 0, 0, 1, 1),
  -- New access, the point of this migration:
  ('payroll',         'WFM_ATTENDANCE_EXCEPTIONS', 1, 0, 0, 0, 1, 1),
  ('hr',              'WFM_ATTENDANCE_EXCEPTIONS', 1, 0, 0, 0, 1, 1),
  ('ceo',             'WFM_ATTENDANCE_EXCEPTIONS', 1, 0, 0, 0, 1, 1)
ON DUPLICATE KEY UPDATE
  can_view      = 1,
  can_export    = 1,
  active_status = 1;

-- ─── Verification (run after applying; expect 10 rows) ────────────────────────
-- SELECT role_key, can_view, can_export, active_status
--   FROM role_page_access
--  WHERE page_code = 'WFM_ATTENDANCE_EXCEPTIONS' AND active_status = 1
--  ORDER BY role_key;
-- SELECT page_code, page_path, active_status FROM page_catalog
--  WHERE page_code = 'WFM_ATTENDANCE_EXCEPTIONS';
