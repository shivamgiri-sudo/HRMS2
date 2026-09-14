-- Migration: 1067_missing_page_catalog_entries.sql
-- Purpose:  page-access-deployment.contract.test.ts failed CI because these 3 page codes are
--           referenced in the frontend (routes, nav config, or rbacPageMatrix.ts grants) but
--           have never had a page_catalog row — so they can't be listed or toggled in the
--           Access Control UI, and (for MODULE_LAUNCHER) the role_page_access grants
--           rbacPageMatrix.ts already declares in code have no matching DB row.
-- Safety:   INSERT IGNORE / ON DUPLICATE KEY UPDATE only. No DROP, no DELETE.
--           Additive, same pattern as 1029_ungated_routes_page_catalog.sql.
-- Created:  2026-08-03

INSERT IGNORE INTO page_catalog (id, page_code, page_name, page_path, module, active_status) VALUES
  (UUID(), 'MCNMEET',                     'MCNmeet',                        '/meetings',                              'Platform', 1),
  (UUID(), 'MODULE_LAUNCHER',             'Module Launcher',                '/modules',                               'Platform', 1),
  (UUID(), 'PAYROLL_SALARY_VERIFICATION', 'Salary Verification',            '/payroll/salary-verification',          'Payroll',  1);

-- MODULE_LAUNCHER is granted in rbacPageMatrix.ts to assistant_manager, interviewer,
-- payroll_admin and recruiter — give those roles the matching DB row. MCNMEET and
-- PAYROLL_SALARY_VERIFICATION are gated at the route level (roles={[...]} on the <Route>
-- itself, not through rbacPageMatrix.ts), so they need only the catalog row above, not a
-- role_page_access grant here.
INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT role_key, 'MODULE_LAUNCHER', 1, 0, 0, 0, 0, 1
FROM (
  SELECT 'assistant_manager' AS role_key
  UNION ALL SELECT 'interviewer'
  UNION ALL SELECT 'payroll_admin'
  UNION ALL SELECT 'recruiter'
) roles
WHERE NOT EXISTS (
  SELECT 1 FROM role_page_access rpa
  WHERE rpa.role_key = roles.role_key AND rpa.page_code = 'MODULE_LAUNCHER' AND rpa.active_status = 1
)
ON DUPLICATE KEY UPDATE can_view = 1, active_status = 1;

-- Backfill super_admin with full access on these 3, same as every other page_catalog row.
INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT 'super_admin', pc.page_code, 1, 1, 1, 1, 1, 1
FROM page_catalog pc
WHERE pc.page_code IN ('MCNMEET', 'MODULE_LAUNCHER', 'PAYROLL_SALARY_VERIFICATION')
  AND NOT EXISTS (
    SELECT 1 FROM role_page_access rpa
    WHERE rpa.role_key = 'super_admin' AND rpa.page_code = pc.page_code AND rpa.active_status = 1
  )
ON DUPLICATE KEY UPDATE
  can_view = 1, can_create = 1, can_edit = 1, can_delete = 1, can_export = 1, active_status = 1;
