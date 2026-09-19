-- 1818_payroll_export_pages_page_access.sql
--
-- Registers the two payroll export pages added 2026-09-18 in page_catalog/role_page_access.
-- Both routes are wrapped in <Gate pageCode=...>; a page code with no page_catalog row and no
-- role grants is denied to every user, so without this the pages cannot be opened even by the
-- roles their route and sidebar entry allow.
--
--   SALARY_TREND_EXPORT         /payroll/salary-trend
--   ATTENDANCE_REGISTER_EXPORT  /payroll/attendance-register
--
-- Roles are exactly the ones already listed on each route's ProtectedRoute and navConfig entry
-- (payroll.routes.tsx / navConfig.tsx) — this grants nothing those two gates did not already
-- name. Read + export only; no create/edit/delete action exists on either page. Idempotent.

INSERT INTO page_catalog (page_code, page_name, page_path, module, description, active_status)
VALUES
  ('SALARY_TREND_EXPORT', 'Salary Trend', '/payroll/salary-trend', 'payroll',
   'Month-by-month salary trend grid for the full financial year.', 1),
  ('ATTENDANCE_REGISTER_EXPORT', 'Attendance Register', '/payroll/attendance-register', 'payroll',
   'Day-wise attendance register with all summary columns.', 1)
ON DUPLICATE KEY UPDATE
  page_name = VALUES(page_name), page_path = VALUES(page_path), module = VALUES(module),
  description = VALUES(description), active_status = VALUES(active_status);

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  (UUID(), 'payroll_head',    'SALARY_TREND_EXPORT', 1, 0, 0, 0, 1, 1),
  (UUID(), 'admin',           'SALARY_TREND_EXPORT', 1, 0, 0, 0, 1, 1),
  (UUID(), 'super_admin',     'SALARY_TREND_EXPORT', 1, 0, 0, 0, 1, 1),
  (UUID(), 'payroll_hr',      'SALARY_TREND_EXPORT', 1, 0, 0, 0, 1, 1),
  (UUID(), 'hr',              'SALARY_TREND_EXPORT', 1, 0, 0, 0, 1, 1),
  (UUID(), 'hr_admin',        'SALARY_TREND_EXPORT', 1, 0, 0, 0, 1, 1),
  (UUID(), 'payroll_head',    'ATTENDANCE_REGISTER_EXPORT', 1, 0, 0, 0, 1, 1),
  (UUID(), 'admin',           'ATTENDANCE_REGISTER_EXPORT', 1, 0, 0, 0, 1, 1),
  (UUID(), 'super_admin',     'ATTENDANCE_REGISTER_EXPORT', 1, 0, 0, 0, 1, 1),
  (UUID(), 'payroll_hr',      'ATTENDANCE_REGISTER_EXPORT', 1, 0, 0, 0, 1, 1),
  (UUID(), 'hr',              'ATTENDANCE_REGISTER_EXPORT', 1, 0, 0, 0, 1, 1),
  (UUID(), 'hr_admin',        'ATTENDANCE_REGISTER_EXPORT', 1, 0, 0, 0, 1, 1),
  (UUID(), 'wfm',             'ATTENDANCE_REGISTER_EXPORT', 1, 0, 0, 0, 1, 1),
  (UUID(), 'branch_head',     'ATTENDANCE_REGISTER_EXPORT', 1, 0, 0, 0, 1, 1),
  (UUID(), 'process_manager', 'ATTENDANCE_REGISTER_EXPORT', 1, 0, 0, 0, 1, 1)
ON DUPLICATE KEY UPDATE
  can_view = VALUES(can_view), can_export = VALUES(can_export), active_status = VALUES(active_status);

SELECT '1818_payroll_export_pages_page_access.sql applied' AS migration_status;

-- Rollback:
--   UPDATE role_page_access SET active_status = 0 WHERE page_code IN ('SALARY_TREND_EXPORT','ATTENDANCE_REGISTER_EXPORT');
--   UPDATE page_catalog     SET active_status = 0 WHERE page_code IN ('SALARY_TREND_EXPORT','ATTENDANCE_REGISTER_EXPORT');
