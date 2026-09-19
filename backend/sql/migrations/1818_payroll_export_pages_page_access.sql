-- 1818_payroll_export_pages_page_access.sql
--
-- Registers SALARY_TREND_EXPORT and ATTENDANCE_REGISTER_EXPORT in
-- page_catalog and grants role_page_access.
--
-- WHY GRANTS ARE ISSUED HERE
-- ---------------------------
-- Without a role_page_access row, the page is invisible to every role
-- except super_admin (useWorkforceAccess bypasses the catalog for
-- super_admin only; all other roles are resolved from role_page_access
-- joined to page_catalog in access.service.ts getAccessMe).
--
-- Role lists match src/config/routes/payroll.routes.tsx ProtectedRoute
-- roles exactly, as read at the time this file was written (2026-09-18).
--   SALARY_TREND_EXPORT:      payroll_head, admin, super_admin, payroll_hr, hr, hr_admin
--   ATTENDANCE_REGISTER_EXPORT: payroll_head, admin, super_admin, payroll_hr, hr, hr_admin,
--                                wfm, branch_head, process_manager
--
-- These are read+export-only pages; no create/edit/delete operations exist.
--
-- Idempotent: page_catalog.page_code is unique and role_page_access has a
-- composite unique key on (role_key, page_code), so re-running updates
-- and inserts nothing twice.

START TRANSACTION;

INSERT INTO page_catalog (page_code, page_name, page_path, module, description, active_status)
VALUES
  ('SALARY_TREND_EXPORT', 'Salary Trend', '/payroll/salary-trend', 'payroll',
   'Month-by-month salary trend grid for the full financial year with CSV export.',
   1),
  ('ATTENDANCE_REGISTER_EXPORT', 'Attendance Register', '/payroll/attendance-register', 'payroll',
   'Day-wise attendance register — complete replica of the I-Spark format with all summary columns and CSV export.',
   1)
ON DUPLICATE KEY UPDATE
  page_name     = VALUES(page_name),
  page_path     = VALUES(page_path),
  module        = VALUES(module),
  description   = VALUES(description),
  active_status = VALUES(active_status);

-- ── SALARY_TREND_EXPORT ────────────────────────────────────────────────────
INSERT INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  (UUID(), 'super_admin',  'SALARY_TREND_EXPORT', 1, 0, 0, 0, 1, 1),
  (UUID(), 'admin',        'SALARY_TREND_EXPORT', 1, 0, 0, 0, 1, 1),
  (UUID(), 'payroll_head', 'SALARY_TREND_EXPORT', 1, 0, 0, 0, 1, 1),
  (UUID(), 'payroll_hr',   'SALARY_TREND_EXPORT', 1, 0, 0, 0, 1, 1),
  (UUID(), 'hr',           'SALARY_TREND_EXPORT', 1, 0, 0, 0, 1, 1),
  (UUID(), 'hr_admin',     'SALARY_TREND_EXPORT', 1, 0, 0, 0, 1, 1)
ON DUPLICATE KEY UPDATE
  can_view      = VALUES(can_view),
  can_create    = VALUES(can_create),
  can_edit      = VALUES(can_edit),
  can_delete    = VALUES(can_delete),
  can_export    = VALUES(can_export),
  active_status = VALUES(active_status);

-- ── ATTENDANCE_REGISTER_EXPORT ────────────────────────────────────────────
INSERT INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  (UUID(), 'super_admin',    'ATTENDANCE_REGISTER_EXPORT', 1, 0, 0, 0, 1, 1),
  (UUID(), 'admin',          'ATTENDANCE_REGISTER_EXPORT', 1, 0, 0, 0, 1, 1),
  (UUID(), 'payroll_head',   'ATTENDANCE_REGISTER_EXPORT', 1, 0, 0, 0, 1, 1),
  (UUID(), 'payroll_hr',     'ATTENDANCE_REGISTER_EXPORT', 1, 0, 0, 0, 1, 1),
  (UUID(), 'hr',             'ATTENDANCE_REGISTER_EXPORT', 1, 0, 0, 0, 1, 1),
  (UUID(), 'hr_admin',       'ATTENDANCE_REGISTER_EXPORT', 1, 0, 0, 0, 1, 1),
  (UUID(), 'wfm',            'ATTENDANCE_REGISTER_EXPORT', 1, 0, 0, 0, 1, 1),
  (UUID(), 'branch_head',    'ATTENDANCE_REGISTER_EXPORT', 1, 0, 0, 0, 1, 1),
  (UUID(), 'process_manager','ATTENDANCE_REGISTER_EXPORT', 1, 0, 0, 0, 1, 1)
ON DUPLICATE KEY UPDATE
  can_view      = VALUES(can_view),
  can_create    = VALUES(can_create),
  can_edit      = VALUES(can_edit),
  can_delete    = VALUES(can_delete),
  can_export    = VALUES(can_export),
  active_status = VALUES(active_status);

COMMIT;

-- Rollback:
--   UPDATE role_page_access SET active_status = 0
--    WHERE page_code IN ('SALARY_TREND_EXPORT','ATTENDANCE_REGISTER_EXPORT');
--   UPDATE page_catalog SET active_status = 0
--    WHERE page_code IN ('SALARY_TREND_EXPORT','ATTENDANCE_REGISTER_EXPORT');
