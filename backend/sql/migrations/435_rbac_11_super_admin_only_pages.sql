-- 435_rbac_11_super_admin_only_pages.sql
--
-- UAT finding D011 (uat-100pct-readiness branch, 2026-08-18): a full scan of
-- page_catalog confirmed 11 live, reachable pages are restricted to super_admin
-- only in role_page_access, despite their backend route guards accepting a broader
-- set of roles.  MATERNITY_LEAVE and ORG_MASTERS from the same sweep were already
-- closed by migrations 1231 and 1233.  This migration closes the remaining 11.
--
-- Verification method for each page:
--   Backend requireRole() calls — re-read at authoring time (2026-08-23).
--   navConfig.tsx roles — confirmed where an explicit array exists.
--   Route gate type — confirmed via src/config/routes/ (Gate vs ProtectedRoute).
--
-- Conservative defaults:
--   can_create / can_edit match the backend's actual write guards, not just the
--   broadest role that can read.
--   can_delete = 0 everywhere unless the backend exposes a DELETE endpoint that
--   explicitly accepts a non-super_admin role.
--   can_export = 1 where backend has an explicit export route; 0 otherwise.
--   super_admin rows are included for audit-log clarity (super_admin already
--   bypasses the DB grant via useWorkforceAccess, but an explicit row keeps
--   role_page_access queries honest, matching the established pattern in 1303+).
--
-- Idempotent: role_page_access has a composite unique key (role_key, page_code).
-- ON DUPLICATE KEY UPDATE is a no-op when the values are identical — safe to
-- re-run.  Does not touch any other existing grant.
--
-- NOT applied to production until explicit user approval (CLAUDE.md §migration-
-- approval rule).  Registered in MIGRATION_MANIFEST so schema_migrations tracks it.

START TRANSACTION;

-- ── 1. ATTENDANCE_BILLING_CONFIG (/attendance/billing-config) ────────────────
-- Backend: GET requires finance_head/admin/hr; POST/PUT requires admin/finance_head.
-- navConfig: admin, hr, wfm, super_admin.
INSERT INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  (UUID(), 'super_admin',   'ATTENDANCE_BILLING_CONFIG', 1, 1, 1, 0, 1, 1),
  (UUID(), 'admin',         'ATTENDANCE_BILLING_CONFIG', 1, 1, 1, 0, 1, 1),
  (UUID(), 'hr',            'ATTENDANCE_BILLING_CONFIG', 1, 0, 0, 0, 1, 1),
  (UUID(), 'wfm',           'ATTENDANCE_BILLING_CONFIG', 1, 0, 0, 0, 0, 1),
  (UUID(), 'finance_head',  'ATTENDANCE_BILLING_CONFIG', 1, 1, 1, 0, 1, 1)
ON DUPLICATE KEY UPDATE
  can_view      = VALUES(can_view),
  can_create    = VALUES(can_create),
  can_edit      = VALUES(can_edit),
  can_export    = VALUES(can_export),
  active_status = 1;

-- ── 2. BENEFITS (/benefits) ──────────────────────────────────────────────────
-- Backend: admin/hr for CRUD; manager/branch_head on navConfig.
-- Employees view their own benefits via self-service; this grant is for the admin
-- surface (/benefits), not the employee self-service path.
INSERT INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  (UUID(), 'super_admin',   'BENEFITS', 1, 1, 1, 1, 1, 1),
  (UUID(), 'admin',         'BENEFITS', 1, 1, 1, 1, 1, 1),
  (UUID(), 'hr',            'BENEFITS', 1, 1, 1, 1, 1, 1),
  (UUID(), 'manager',       'BENEFITS', 1, 0, 0, 0, 0, 1),
  (UUID(), 'branch_head',   'BENEFITS', 1, 0, 0, 0, 0, 1)
ON DUPLICATE KEY UPDATE
  can_view      = VALUES(can_view),
  can_create    = VALUES(can_create),
  can_edit      = VALUES(can_edit),
  can_delete    = VALUES(can_delete),
  can_export    = VALUES(can_export),
  active_status = 1;

-- ── 3. CLIENT_MASTER (/client-master) ────────────────────────────────────────
-- Backend: admin/hr throughout; PATCH status/subscription is admin-only.
-- navConfig: admin, hr.
INSERT INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  (UUID(), 'super_admin',   'CLIENT_MASTER', 1, 1, 1, 1, 1, 1),
  (UUID(), 'admin',         'CLIENT_MASTER', 1, 1, 1, 1, 1, 1),
  (UUID(), 'hr',            'CLIENT_MASTER', 1, 1, 1, 0, 1, 1)
ON DUPLICATE KEY UPDATE
  can_view      = VALUES(can_view),
  can_create    = VALUES(can_create),
  can_edit      = VALUES(can_edit),
  can_delete    = VALUES(can_delete),
  can_export    = VALUES(can_export),
  active_status = 1;

-- ── 4. COMPLIANCE_AUDIT_REPORT (/compliance/audit-report) ────────────────────
-- NOTE: This route uses ProtectedRoute roles={['admin','hr','super_admin']}, NOT a
-- Gate wrapper.  The role_page_access grant here controls nav-item visibility only,
-- not route access (which the ProtectedRoute prop guards independently).
-- Backend JOURNEY_ROLES is very broad; grant is narrowed to the navConfig set.
INSERT INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  (UUID(), 'super_admin',   'COMPLIANCE_AUDIT_REPORT', 1, 0, 0, 0, 1, 1),
  (UUID(), 'admin',         'COMPLIANCE_AUDIT_REPORT', 1, 0, 0, 0, 1, 1),
  (UUID(), 'hr',            'COMPLIANCE_AUDIT_REPORT', 1, 0, 0, 0, 1, 1)
ON DUPLICATE KEY UPDATE
  can_view      = VALUES(can_view),
  can_export    = VALUES(can_export),
  active_status = 1;

-- ── 5. EXIT_COMMAND_CENTER (/exit/command-center) ────────────────────────────
-- Backend GET: admin/hr/manager/finance/payroll/ceo.
-- Backend POST/PATCH: admin/hr/manager.
INSERT INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  (UUID(), 'super_admin',   'EXIT_COMMAND_CENTER', 1, 1, 1, 0, 1, 1),
  (UUID(), 'admin',         'EXIT_COMMAND_CENTER', 1, 1, 1, 0, 1, 1),
  (UUID(), 'hr',            'EXIT_COMMAND_CENTER', 1, 1, 1, 0, 1, 1),
  (UUID(), 'manager',       'EXIT_COMMAND_CENTER', 1, 1, 1, 0, 0, 1),
  (UUID(), 'finance',       'EXIT_COMMAND_CENTER', 1, 0, 0, 0, 0, 1),
  (UUID(), 'payroll',       'EXIT_COMMAND_CENTER', 1, 0, 0, 0, 0, 1),
  (UUID(), 'ceo',           'EXIT_COMMAND_CENTER', 1, 0, 0, 0, 1, 1)
ON DUPLICATE KEY UPDATE
  can_view      = VALUES(can_view),
  can_create    = VALUES(can_create),
  can_edit      = VALUES(can_edit),
  can_export    = VALUES(can_export),
  active_status = 1;

-- ── 6. LEAVE_TYPES (/leave-types) ────────────────────────────────────────────
-- Backend: admin/hr/super_admin for all ops; admin-only for delete.
-- navConfig: admin, hr.
INSERT INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  (UUID(), 'super_admin',   'LEAVE_TYPES', 1, 1, 1, 1, 1, 1),
  (UUID(), 'admin',         'LEAVE_TYPES', 1, 1, 1, 1, 1, 1),
  (UUID(), 'hr',            'LEAVE_TYPES', 1, 1, 1, 0, 1, 1)
ON DUPLICATE KEY UPDATE
  can_view      = VALUES(can_view),
  can_create    = VALUES(can_create),
  can_edit      = VALUES(can_edit),
  can_delete    = VALUES(can_delete),
  can_export    = VALUES(can_export),
  active_status = 1;

-- ── 7. MCNMEET (/meetings) ────────────────────────────────────────────────────
-- Backend MANAGER_ROLES: admin/hr/hr_admin/manager/process_manager/branch_head/
--   trainer/coordinator/wfm/tl/team_leader.
-- Grant is scoped to the core operational set; edge roles (trainer/coordinator/tl)
-- can read in the backend but are not granted nav visibility here — they can still
-- reach the endpoint directly; this only controls sidebar discoverability.
INSERT INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  (UUID(), 'super_admin',       'MCNMEET', 1, 1, 1, 1, 1, 1),
  (UUID(), 'admin',             'MCNMEET', 1, 1, 1, 1, 1, 1),
  (UUID(), 'hr',                'MCNMEET', 1, 1, 1, 1, 1, 1),
  (UUID(), 'manager',           'MCNMEET', 1, 1, 1, 0, 0, 1),
  (UUID(), 'process_manager',   'MCNMEET', 1, 1, 1, 0, 0, 1),
  (UUID(), 'branch_head',       'MCNMEET', 1, 1, 1, 0, 0, 1),
  (UUID(), 'wfm',               'MCNMEET', 1, 0, 0, 0, 0, 1)
ON DUPLICATE KEY UPDATE
  can_view      = VALUES(can_view),
  can_create    = VALUES(can_create),
  can_edit      = VALUES(can_edit),
  can_delete    = VALUES(can_delete),
  can_export    = VALUES(can_export),
  active_status = 1;

-- ── 8. MOBILITY (/mobility) ──────────────────────────────────────────────────
-- Backend GET: no requireRole (any authenticated user).
-- Backend POST/PATCH: admin/hr.
-- Granting view to manager/branch_head for operational visibility; write to admin/hr only.
INSERT INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  (UUID(), 'super_admin',   'MOBILITY', 1, 1, 1, 0, 1, 1),
  (UUID(), 'admin',         'MOBILITY', 1, 1, 1, 0, 1, 1),
  (UUID(), 'hr',            'MOBILITY', 1, 1, 1, 0, 1, 1),
  (UUID(), 'manager',       'MOBILITY', 1, 0, 0, 0, 0, 1),
  (UUID(), 'branch_head',   'MOBILITY', 1, 0, 0, 0, 0, 1)
ON DUPLICATE KEY UPDATE
  can_view      = VALUES(can_view),
  can_create    = VALUES(can_create),
  can_edit      = VALUES(can_edit),
  can_export    = VALUES(can_export),
  active_status = 1;

-- ── 9. PORTAL_DATA_MANAGER (/portal-data-manager) ────────────────────────────
-- Backend: admin/hr for snapshot queue and access log.
-- Intentionally narrow — this surface controls what data clients see; wrong grants
-- here could expose org-wide data to the wrong operator.
INSERT INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  (UUID(), 'super_admin',   'PORTAL_DATA_MANAGER', 1, 1, 1, 1, 1, 1),
  (UUID(), 'admin',         'PORTAL_DATA_MANAGER', 1, 1, 1, 0, 1, 1),
  (UUID(), 'hr',            'PORTAL_DATA_MANAGER', 1, 1, 1, 0, 1, 1)
ON DUPLICATE KEY UPDATE
  can_view      = VALUES(can_view),
  can_create    = VALUES(can_create),
  can_edit      = VALUES(can_edit),
  can_delete    = VALUES(can_delete),
  can_export    = VALUES(can_export),
  active_status = 1;

-- ── 10. PROCESS_CONFIG (/process-config) ─────────────────────────────────────
-- Backend GET: admin/hr/manager; POST: admin/hr/process_manager;
-- DELETE: admin/hr.  navConfig: admin, hr, process_manager.
INSERT INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  (UUID(), 'super_admin',     'PROCESS_CONFIG', 1, 1, 1, 1, 1, 1),
  (UUID(), 'admin',           'PROCESS_CONFIG', 1, 1, 1, 1, 1, 1),
  (UUID(), 'hr',              'PROCESS_CONFIG', 1, 1, 1, 1, 1, 1),
  (UUID(), 'manager',         'PROCESS_CONFIG', 1, 0, 0, 0, 0, 1),
  (UUID(), 'process_manager', 'PROCESS_CONFIG', 1, 1, 1, 0, 0, 1)
ON DUPLICATE KEY UPDATE
  can_view      = VALUES(can_view),
  can_create    = VALUES(can_create),
  can_edit      = VALUES(can_edit),
  can_delete    = VALUES(can_delete),
  can_export    = VALUES(can_export),
  active_status = 1;

-- ── 11. SUPPORT_COMMAND_CENTER (/support/command-center) ─────────────────────
-- Backend /command-center: admin/hr/manager/process_manager/it/branch_it/it_admin.
-- Backend PATCH/assign/resolve (write ops): HELPDESK_ADMIN_ROLES =
--   admin/hr/super_admin/it/branch_it/it_admin.
INSERT INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  (UUID(), 'super_admin',     'SUPPORT_COMMAND_CENTER', 1, 1, 1, 1, 1, 1),
  (UUID(), 'admin',           'SUPPORT_COMMAND_CENTER', 1, 1, 1, 0, 1, 1),
  (UUID(), 'hr',              'SUPPORT_COMMAND_CENTER', 1, 1, 1, 0, 1, 1),
  (UUID(), 'it',              'SUPPORT_COMMAND_CENTER', 1, 1, 1, 0, 1, 1),
  (UUID(), 'branch_it',       'SUPPORT_COMMAND_CENTER', 1, 1, 1, 0, 0, 1),
  (UUID(), 'it_admin',        'SUPPORT_COMMAND_CENTER', 1, 1, 1, 0, 1, 1),
  (UUID(), 'manager',         'SUPPORT_COMMAND_CENTER', 1, 0, 0, 0, 0, 1),
  (UUID(), 'process_manager', 'SUPPORT_COMMAND_CENTER', 1, 0, 0, 0, 0, 1)
ON DUPLICATE KEY UPDATE
  can_view      = VALUES(can_view),
  can_create    = VALUES(can_create),
  can_edit      = VALUES(can_edit),
  can_delete    = VALUES(can_delete),
  can_export    = VALUES(can_export),
  active_status = 1;

COMMIT;

SELECT '435_rbac_11_super_admin_only_pages.sql applied — role_page_access grants added for ATTENDANCE_BILLING_CONFIG, BENEFITS, CLIENT_MASTER, COMPLIANCE_AUDIT_REPORT, EXIT_COMMAND_CENTER, LEAVE_TYPES, MCNMEET, MOBILITY, PORTAL_DATA_MANAGER, PROCESS_CONFIG, SUPPORT_COMMAND_CENTER' AS migration_status;
