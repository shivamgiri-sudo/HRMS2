-- 537_visitor_roles_catalog.sql
-- Seeds visitor management roles and ensures security_head / branch_hr
-- are present in workforce_role_catalog (required for FK on user_roles).

USE mas_hrms;

INSERT INTO workforce_role_catalog (role_key, role_name, description, active_status)
VALUES
  ('security_head',     'Security Head',         'Manages physical security, visitor access and guard operations across branches', 1),
  ('visitor_security',  'Visitor Security Guard', 'Front-desk / gate security staff who check visitors in and out',               1),
  ('visitor_reception', 'Visitor Receptionist',   'Reception staff who register walk-in visitors at the front desk',              1),
  ('branch_hr',         'Branch HR',              'HR staff scoped to a specific branch — handles local onboarding and approvals', 1),
  ('hr_branch',         'HR Branch Officer',      'Branch-level HR officer with visitor and employee record access',               1)
ON DUPLICATE KEY UPDATE
  role_name   = VALUES(role_name),
  description = VALUES(description),
  active_status = 1;

SELECT 'Migration 537 applied: visitor management roles seeded into workforce_role_catalog' AS status;
