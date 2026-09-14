-- Migration 376: Register /profile in page_catalog and grant access to all roles
-- Allows super-admin to globally enable/disable the Profile page from the Page Access control UI

INSERT INTO page_catalog (page_code, page_name, page_path, module, description, active_status)
VALUES ('MY_PROFILE', 'My Profile', '/profile', 'Employee Self-Service', 'Employee self-service profile page — personal details, KYC, bank info, password change', 1)
ON DUPLICATE KEY UPDATE
  page_name   = VALUES(page_name),
  page_path   = VALUES(page_path),
  module      = VALUES(module),
  description = VALUES(description);

-- Grant access to every role (Profile is universally accessible to all authenticated users)
INSERT INTO role_page_access (role_key, page_code, can_view, can_edit)
VALUES
  ('super_admin',     'MY_PROFILE', 1, 1),
  ('admin',           'MY_PROFILE', 1, 1),
  ('hr',              'MY_PROFILE', 1, 1),
  ('hr_admin',        'MY_PROFILE', 1, 1),
  ('recruitment_hr',  'MY_PROFILE', 1, 1),
  ('recruiter',       'MY_PROFILE', 1, 1),
  ('payroll',         'MY_PROFILE', 1, 1),
  ('payroll_hr',      'MY_PROFILE', 1, 1),
  ('payroll_admin',   'MY_PROFILE', 1, 1),
  ('payroll_head',    'MY_PROFILE', 1, 1),
  ('finance',         'MY_PROFILE', 1, 1),
  ('manager',         'MY_PROFILE', 1, 1),
  ('branch_head',     'MY_PROFILE', 1, 1),
  ('branch_admin',    'MY_PROFILE', 1, 1),
  ('branch_it',       'MY_PROFILE', 1, 1),
  ('operations',      'MY_PROFILE', 1, 1),
  ('process_manager', 'MY_PROFILE', 1, 1),
  ('assistant_manager','MY_PROFILE', 1, 1),
  ('team_leader',     'MY_PROFILE', 1, 1),
  ('tl',              'MY_PROFILE', 1, 1),
  ('qa',              'MY_PROFILE', 1, 1),
  ('trainer',         'MY_PROFILE', 1, 1),
  ('wfm',             'MY_PROFILE', 1, 1),
  ('it',              'MY_PROFILE', 1, 1),
  ('analyst',         'MY_PROFILE', 1, 1),
  ('interviewer',     'MY_PROFILE', 1, 1),
  ('ceo',             'MY_PROFILE', 1, 1),
  ('employee',        'MY_PROFILE', 1, 1)
ON DUPLICATE KEY UPDATE can_view = 1, can_edit = 1;
