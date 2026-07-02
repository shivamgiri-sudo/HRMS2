-- 045_role_compat.sql
-- Role naming compatibility: add process_manager and team_leader as canonical roles,
-- keep manager and tl as aliases so existing user_roles rows continue to work.
-- Decision confirmed: manager = process_manager, tl = team_leader.
USE mas_hrms;

-- Add canonical role names to workforce_role_catalog
INSERT INTO workforce_role_catalog (role_key, role_name, description, active_status)
VALUES
  ('process_manager', 'Process Manager',  'Canonical alias for manager role',    1),
  ('team_leader',     'Team Leader',       'Canonical alias for tl role',         1),
  ('branch_head',     'Branch Head',       'Branch-level operations head',        1),
  ('finance',         'Finance',           'Finance team member',                 1),
  ('payroll',         'Payroll',           'Payroll team member',                 1),
  ('trainer',         'Trainer / L&D',     'Learning and development trainer',    1),
  ('ceo',             'CEO / Leadership',  'Executive leadership access',         1)
ON DUPLICATE KEY UPDATE role_name = VALUES(role_name), active_status = 1;

-- Mirror existing manager rows as process_manager (non-destructive)
INSERT INTO user_roles (id, user_id, role_key, active_status)
SELECT UUID(), user_id, 'process_manager', 1
FROM user_roles
WHERE role_key = 'manager' AND active_status = 1
ON DUPLICATE KEY UPDATE active_status = 1;

-- Mirror existing tl rows as team_leader (non-destructive)
INSERT INTO user_roles (id, user_id, role_key, active_status)
SELECT UUID(), user_id, 'team_leader', 1
FROM user_roles
WHERE role_key = 'tl' AND active_status = 1
ON DUPLICATE KEY UPDATE active_status = 1;

-- Seed role_page_access for process_manager (mirrors manager grants)
INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export)
SELECT 'process_manager', page_code, can_view, can_create, can_edit, can_delete, can_export
FROM role_page_access
WHERE role_key = 'manager'
ON DUPLICATE KEY UPDATE can_view = VALUES(can_view);

-- Seed role_page_access for team_leader (mirrors tl grants)
INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export)
SELECT 'team_leader', page_code, can_view, can_create, can_edit, can_delete, can_export
FROM role_page_access
WHERE role_key = 'tl'
ON DUPLICATE KEY UPDATE can_view = VALUES(can_view);

SELECT 'Role compat migration 045 complete' AS status;
