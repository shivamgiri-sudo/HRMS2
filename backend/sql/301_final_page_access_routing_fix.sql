-- Migration 301: Final page access and routing fix
-- Registers all missing page codes in page_catalog with page_path
-- Grants super_admin full access to all new page codes
-- Grants user-level access to shivam.giri@teammas.in
-- Safe to re-run: INSERT IGNORE / ON DUPLICATE KEY UPDATE throughout

-- ---------------------------------------------------------------
-- Step 1: page_catalog entries for all missing page codes
-- ---------------------------------------------------------------
INSERT IGNORE INTO page_catalog (id, page_code, page_name, page_path, module, description, active_status)
VALUES
  (UUID(), 'DPDP_WITHDRAWAL',              'DPDP Withdrawal Request',          '/privacy/dpdp-withdrawal',                'compliance',  'Employee DPDP data withdrawal self-service',         1),
  (UUID(), 'DPDP_WITHDRAWAL_ADMIN',        'DPDP Withdrawal Admin',            '/compliance/dpdp-withdrawal-admin',       'compliance',  'Admin review and processing of DPDP withdrawals',   1),
  (UUID(), 'CEO_DASHBOARD',                'CEO Dashboard',                    '/ceo/dashboard',                          'dashboards',  'Executive command dashboard',                        1),
  (UUID(), 'PAYROLL_HR_DASHBOARD',         'Payroll HR Dashboard',             '/payroll-hr/dashboard',                   'dashboards',  'Payroll HR validation dashboard',                   1),
  (UUID(), 'WFM_DASHBOARD',                'WFM Dashboard',                    '/wfm/dashboard',                          'dashboards',  'Workforce management dashboard',                     1),
  (UUID(), 'HR_DASHBOARD',                 'HR Dashboard',                     '/hr/dashboard',                           'dashboards',  'HR operations dashboard',                            1),
  (UUID(), 'EMPLOYEE_SELF_DASHBOARD',      'My Dashboard',                     '/my-dashboard',                           'dashboards',  'Employee self-service dashboard',                    1),
  (UUID(), 'ONBOARDING_FULL',              'Full Onboarding Form',             '/onboard-full',                           'ats',         'Candidate full onboarding digital form',             1),
  (UUID(), 'APPOINTMENT_ESIGN',            'Appointment Letter E-Sign',        '/letters/appointment-esign',              'letters',     'Appointment letter e-sign workflow',                 1),
  (UUID(), 'TAT_MATRIX',                   'TAT Escalation Matrix',            '/governance/tat-matrix',                  'governance',  'Turn-around time escalation configuration matrix',  1),
  (UUID(), 'TAT_DASHBOARD',                'TAT Dashboard',                    '/governance/tat-dashboard',               'governance',  'TAT monitoring and escalation dashboard',            1),
  (UUID(), 'NAME_CONSISTENCY_MATRIX',      'Name Consistency Matrix',          '/ats/name-consistency',                   'ats',         'Candidate name consistency audit matrix',            1),
  (UUID(), 'RESIGNATION_MY_REQUEST',       'My Resignation Request',           '/exit/resignation',                       'exit',        'Employee self-service resignation request',          1),
  (UUID(), 'RESIGNATION_COMMAND_CENTER',   'Resignation Command Center',       '/exit/resignation-command-center',        'exit',        'HR resignation review and processing command center',1);

-- ---------------------------------------------------------------
-- Step 2: super_admin role grants for all above page codes
-- ---------------------------------------------------------------
INSERT IGNORE INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), 'super_admin', page_code, 1, 1, 1, 1, 1, 1
FROM page_catalog
WHERE page_code IN (
  'DPDP_WITHDRAWAL',
  'DPDP_WITHDRAWAL_ADMIN',
  'CEO_DASHBOARD',
  'PAYROLL_HR_DASHBOARD',
  'WFM_DASHBOARD',
  'HR_DASHBOARD',
  'EMPLOYEE_SELF_DASHBOARD',
  'ONBOARDING_FULL',
  'APPOINTMENT_ESIGN',
  'TAT_MATRIX',
  'TAT_DASHBOARD',
  'NAME_CONSISTENCY_MATRIX',
  'RESIGNATION_MY_REQUEST',
  'RESIGNATION_COMMAND_CENTER'
);

-- ---------------------------------------------------------------
-- Step 3: user-level grants for shivam.giri@teammas.in
-- ---------------------------------------------------------------
INSERT INTO user_page_access
  (id, user_id, page_code, can_view, can_create, can_edit, can_delete, can_export, assigned_by, active_status, notes)
SELECT UUID(), u.id, pages.page_code, 1, 1, 1, 1, 1, u.id, 1,
       'Migration 301: final page access and routing fix'
FROM auth_user u
JOIN (
  SELECT 'DPDP_WITHDRAWAL'              AS page_code UNION ALL
  SELECT 'DPDP_WITHDRAWAL_ADMIN'                     UNION ALL
  SELECT 'CEO_DASHBOARD'                             UNION ALL
  SELECT 'PAYROLL_HR_DASHBOARD'                      UNION ALL
  SELECT 'WFM_DASHBOARD'                             UNION ALL
  SELECT 'HR_DASHBOARD'                              UNION ALL
  SELECT 'EMPLOYEE_SELF_DASHBOARD'                   UNION ALL
  SELECT 'ONBOARDING_FULL'                           UNION ALL
  SELECT 'APPOINTMENT_ESIGN'                         UNION ALL
  SELECT 'TAT_MATRIX'                                UNION ALL
  SELECT 'TAT_DASHBOARD'                             UNION ALL
  SELECT 'NAME_CONSISTENCY_MATRIX'                   UNION ALL
  SELECT 'RESIGNATION_MY_REQUEST'                    UNION ALL
  SELECT 'RESIGNATION_COMMAND_CENTER'
) pages
WHERE LOWER(u.email) = LOWER('shivam.giri@teammas.in')
ON DUPLICATE KEY UPDATE
  can_view   = VALUES(can_view),
  can_create = VALUES(can_create),
  can_edit   = VALUES(can_edit),
  can_delete = VALUES(can_delete),
  can_export = VALUES(can_export),
  active_status = 1,
  notes      = VALUES(notes);
