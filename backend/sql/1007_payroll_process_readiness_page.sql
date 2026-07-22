-- Migration 1007: Register PAYROLL_PROCESS_READINESS page catalog entry
-- Grants: payroll_head, super_admin, payroll, payroll_branch, branch_head, admin, hr, wfm, process_manager

INSERT IGNORE INTO workforce_page_catalog
  (page_code, page_name, module, route_path, description, is_active)
VALUES
  ('PAYROLL_PROCESS_READINESS', 'Process Payroll Readiness', 'PAYROLL',
   '/payroll/process-readiness',
   'Process-level payroll readiness with WFM attendance declaration and process manager sign-off', 1);

INSERT IGNORE INTO workforce_role_page_permissions
  (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export)
VALUES
  ('super_admin',     'PAYROLL_PROCESS_READINESS', 1, 1, 1, 1, 1),
  ('admin',           'PAYROLL_PROCESS_READINESS', 1, 1, 1, 0, 1),
  ('payroll_head',    'PAYROLL_PROCESS_READINESS', 1, 1, 1, 0, 1),
  ('payroll',         'PAYROLL_PROCESS_READINESS', 1, 0, 0, 0, 1),
  ('payroll_branch',  'PAYROLL_PROCESS_READINESS', 1, 0, 1, 0, 0),
  ('branch_head',     'PAYROLL_PROCESS_READINESS', 1, 0, 1, 0, 0),
  ('hr',              'PAYROLL_PROCESS_READINESS', 1, 0, 0, 0, 0),
  ('wfm',             'PAYROLL_PROCESS_READINESS', 1, 0, 1, 0, 0),
  ('process_manager', 'PAYROLL_PROCESS_READINESS', 1, 0, 1, 0, 0),
  ('finance',         'PAYROLL_PROCESS_READINESS', 1, 0, 0, 0, 1);

SELECT '1007_payroll_process_readiness_page.sql applied successfully' AS migration_status;
