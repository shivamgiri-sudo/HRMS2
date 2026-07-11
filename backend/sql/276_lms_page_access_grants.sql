-- 276_lms_page_access_grants.sql
-- Registers LMS page_catalog entries, role_page_access grants, and shivam.giri user grants.

USE mas_hrms;

-- Ensure LMS roles exist
INSERT INTO workforce_role_catalog (role_key, role_name, description, active_status) VALUES
('trainer', 'Trainer', 'LMS trainer / coordinator', 1),
('training', 'Training Manager', 'Training management', 1),
('quality', 'Quality Analyst', 'Quality and training', 1),
('operations_head', 'Operations Head', 'Operations head access', 1)
ON DUPLICATE KEY UPDATE active_status = 1;

-- Register LMS pages
INSERT INTO page_catalog (page_code, page_name, module, page_path, description, active_status) VALUES
('LMS_MY_LEARNING',         'LMS My Learning',          'LMS', '/lms/my-learning',         'Employee learning dashboard from LMS', 1),
('LMS_COORDINATOR',         'LMS Coordinator',           'LMS', '/lms/coordinator',          'Coordinator batch and trainee view', 1),
('LMS_ADMIN',               'LMS Admin Dashboard',       'LMS', '/lms/admin',                'Global LMS statistics and admin view', 1),
('LMS_PROGRESS_DASHBOARD',  'LMS Progress Dashboard',    'LMS', '/lms/progress-dashboard',   'Aggregated learning progress across employees', 1),
('LMS_INTEGRATION',         'LMS Integration Admin',     'LMS', '/lms/integration',          'LMS credentials, sync and mapping admin', 1),
('LMS_MODULE_LAUNCH',       'LMS Module Launch',         'LMS', '/lms/module-launch',        'Launch exact LMS UI with SSO', 1)
ON DUPLICATE KEY UPDATE
  page_name = VALUES(page_name),
  module = VALUES(module),
  page_path = VALUES(page_path),
  description = VALUES(description),
  active_status = 1;

-- Role grants
INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status) VALUES
-- LMS_MY_LEARNING — all roles
('employee',        'LMS_MY_LEARNING', 1, 0, 0, 0, 0, 1),
('trainer',         'LMS_MY_LEARNING', 1, 0, 0, 0, 1, 1),
('training',        'LMS_MY_LEARNING', 1, 0, 0, 0, 1, 1),
('quality',         'LMS_MY_LEARNING', 1, 0, 0, 0, 1, 1),
('hr',              'LMS_MY_LEARNING', 1, 0, 0, 0, 1, 1),
('admin',           'LMS_MY_LEARNING', 1, 0, 0, 0, 1, 1),
('super_admin',     'LMS_MY_LEARNING', 1, 0, 0, 0, 1, 1),
('operations_head', 'LMS_MY_LEARNING', 1, 0, 0, 0, 1, 1),
('branch_head',     'LMS_MY_LEARNING', 1, 0, 0, 0, 1, 1),
-- LMS_COORDINATOR
('trainer',         'LMS_COORDINATOR', 1, 0, 1, 0, 1, 1),
('training',        'LMS_COORDINATOR', 1, 0, 1, 0, 1, 1),
('quality',         'LMS_COORDINATOR', 1, 0, 1, 0, 1, 1),
('hr',              'LMS_COORDINATOR', 1, 0, 0, 0, 1, 1),
('admin',           'LMS_COORDINATOR', 1, 1, 1, 1, 1, 1),
('super_admin',     'LMS_COORDINATOR', 1, 1, 1, 1, 1, 1),
-- LMS_ADMIN
('admin',           'LMS_ADMIN', 1, 1, 1, 1, 1, 1),
('super_admin',     'LMS_ADMIN', 1, 1, 1, 1, 1, 1),
('hr',              'LMS_ADMIN', 1, 0, 0, 0, 1, 1),
('operations_head', 'LMS_ADMIN', 1, 0, 0, 0, 1, 1),
-- LMS_PROGRESS_DASHBOARD
('admin',           'LMS_PROGRESS_DASHBOARD', 1, 0, 0, 0, 1, 1),
('super_admin',     'LMS_PROGRESS_DASHBOARD', 1, 0, 0, 0, 1, 1),
('hr',              'LMS_PROGRESS_DASHBOARD', 1, 0, 0, 0, 1, 1),
('operations_head', 'LMS_PROGRESS_DASHBOARD', 1, 0, 0, 0, 1, 1),
('branch_head',     'LMS_PROGRESS_DASHBOARD', 1, 0, 0, 0, 1, 1),
-- LMS_INTEGRATION
('admin',           'LMS_INTEGRATION', 1, 1, 1, 1, 1, 1),
('super_admin',     'LMS_INTEGRATION', 1, 1, 1, 1, 1, 1),
('hr',              'LMS_INTEGRATION', 1, 0, 0, 0, 1, 1),
-- LMS_MODULE_LAUNCH
('employee',        'LMS_MODULE_LAUNCH', 1, 0, 0, 0, 0, 1),
('trainer',         'LMS_MODULE_LAUNCH', 1, 0, 0, 0, 0, 1),
('training',        'LMS_MODULE_LAUNCH', 1, 0, 0, 0, 0, 1),
('quality',         'LMS_MODULE_LAUNCH', 1, 0, 0, 0, 0, 1),
('hr',              'LMS_MODULE_LAUNCH', 1, 0, 0, 0, 0, 1),
('admin',           'LMS_MODULE_LAUNCH', 1, 0, 0, 0, 0, 1),
('super_admin',     'LMS_MODULE_LAUNCH', 1, 0, 0, 0, 0, 1),
('operations_head', 'LMS_MODULE_LAUNCH', 1, 0, 0, 0, 0, 1),
('branch_head',     'LMS_MODULE_LAUNCH', 1, 0, 0, 0, 0, 1)
ON DUPLICATE KEY UPDATE
  can_view = VALUES(can_view),
  can_create = VALUES(can_create),
  can_edit = VALUES(can_edit),
  can_delete = VALUES(can_delete),
  can_export = VALUES(can_export),
  active_status = 1;

-- Grant all LMS pages to shivam.giri@teammas.in
INSERT INTO user_page_access
  (id, user_id, page_code, can_view, can_create, can_edit, can_delete, can_export, assigned_by, active_status, notes)
SELECT UUID(), u.id, pages.page_code, 1, 1, 1, 0, 1, u.id, 1, 'LMS stabilization - migration 276'
FROM auth_user u
JOIN (
  SELECT 'LMS_MY_LEARNING'        AS page_code UNION ALL
  SELECT 'LMS_COORDINATOR'                     UNION ALL
  SELECT 'LMS_ADMIN'                           UNION ALL
  SELECT 'LMS_PROGRESS_DASHBOARD'              UNION ALL
  SELECT 'LMS_INTEGRATION'                     UNION ALL
  SELECT 'LMS_MODULE_LAUNCH'
) pages
WHERE LOWER(u.email) = LOWER('shivam.giri@teammas.in')
ON DUPLICATE KEY UPDATE
  can_view = 1, can_create = 1, can_edit = 1, can_export = 1,
  active_status = 1, notes = VALUES(notes);
