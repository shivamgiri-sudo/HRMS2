-- Migration: 1025_page_catalog_completeness_and_module_normalisation.sql
-- Purpose:  Additive. Normalises module names in page_catalog to a consistent set,
--           adds missing pages for all active frontend routes, and backfills
--           super_admin with full permissions for every active page.
-- Safety:   INSERT IGNORE / ON DUPLICATE KEY UPDATE only. No DROP, no DELETE.
--           NOT EXECUTED AUTOMATICALLY — run manually on staging first.
-- Created:  2026-07-31

-- ─── Step 1: Normalise module column values ────────────────────────────────────
-- Fix inconsistent casing and grouping so the UI module grid shows clean names.

UPDATE page_catalog SET module = 'Dashboards'    WHERE module IN ('Dashboard', 'dashboards', 'dashboard');
UPDATE page_catalog SET module = 'ATS'           WHERE module IN ('ats', 'Recruitment', 'recruitment');
UPDATE page_catalog SET module = 'Employees'     WHERE module IN ('Employee', 'employee', 'employees', 'HRMS', 'HR');
UPDATE page_catalog SET module = 'Attendance'    WHERE module IN ('attendance', 'Attendance Management');
UPDATE page_catalog SET module = 'Leave'         WHERE module IN ('leave', 'Leave Management');
UPDATE page_catalog SET module = 'WFM'           WHERE module IN ('wfm', 'Workforce Management', 'workforce');
UPDATE page_catalog SET module = 'Payroll'       WHERE module IN ('payroll', 'Salary', 'salary', 'Finance');
UPDATE page_catalog SET module = 'Quality'       WHERE module IN ('quality', 'QA', 'qa', 'Quality Management');
UPDATE page_catalog SET module = 'Reports'       WHERE module IN ('reports', 'report', 'Report');
UPDATE page_catalog SET module = 'LMS'           WHERE module IN ('lms', 'Training', 'training');
UPDATE page_catalog SET module = 'Access'        WHERE module IN ('access', 'RBAC', 'rbac', 'Permissions');
UPDATE page_catalog SET module = 'Settings'      WHERE module IN ('settings', 'setting', 'Configuration', 'config');
UPDATE page_catalog SET module = 'Admin'         WHERE module IN ('admin', 'administration', 'Administration', 'Super Admin');
UPDATE page_catalog SET module = 'Exit'          WHERE module IN ('exit', 'Exit Management', 'Resignation', 'resignation', 'fnf', 'FNF');
UPDATE page_catalog SET module = 'Client Portal' WHERE module IN ('client_portal', 'ClientPortal', 'client portal', 'portal');
UPDATE page_catalog SET module = 'Integrations'  WHERE module IN ('integrations', 'integration', 'Integration Hub', 'hub');
UPDATE page_catalog SET module = 'Finance'       WHERE module IN ('finance', 'accounts', 'Accounts');

-- Fix empty/null module values — assign based on page_code prefix patterns
UPDATE page_catalog SET module = 'Dashboards'  WHERE (module IS NULL OR module = '') AND page_code LIKE '%DASHBOARD%';
UPDATE page_catalog SET module = 'ATS'         WHERE (module IS NULL OR module = '') AND page_code LIKE '%ATS%';
UPDATE page_catalog SET module = 'Employees'   WHERE (module IS NULL OR module = '') AND (page_code LIKE '%EMPLOYEE%' OR page_code LIKE '%PROFILE%');
UPDATE page_catalog SET module = 'Attendance'  WHERE (module IS NULL OR module = '') AND page_code LIKE '%ATTENDANCE%';
UPDATE page_catalog SET module = 'Leave'       WHERE (module IS NULL OR module = '') AND page_code LIKE '%LEAVE%';
UPDATE page_catalog SET module = 'WFM'         WHERE (module IS NULL OR module = '') AND (page_code LIKE '%WFM%' OR page_code LIKE '%ROSTER%' OR page_code LIKE '%WORKFORCE%');
UPDATE page_catalog SET module = 'Payroll'     WHERE (module IS NULL OR module = '') AND page_code LIKE '%PAYROLL%';
UPDATE page_catalog SET module = 'Quality'     WHERE (module IS NULL OR module = '') AND (page_code LIKE '%QUALITY%' OR page_code LIKE '%QA%');
UPDATE page_catalog SET module = 'Reports'     WHERE (module IS NULL OR module = '') AND page_code LIKE '%REPORT%';
UPDATE page_catalog SET module = 'LMS'         WHERE (module IS NULL OR module = '') AND page_code LIKE '%LMS%';
UPDATE page_catalog SET module = 'Access'      WHERE (module IS NULL OR module = '') AND (page_code LIKE '%ACCESS%' OR page_code LIKE '%RBAC%');
UPDATE page_catalog SET module = 'Settings'    WHERE (module IS NULL OR module = '') AND page_code LIKE '%SETTING%';
UPDATE page_catalog SET module = 'Exit'        WHERE (module IS NULL OR module = '') AND (page_code LIKE '%EXIT%' OR page_code LIKE '%RESIGN%' OR page_code LIKE '%FNF%');
UPDATE page_catalog SET module = 'Admin'       WHERE (module IS NULL OR module = '') AND (page_code LIKE '%ADMIN%' OR page_code LIKE '%SUPER%');
UPDATE page_catalog SET module = 'Integrations' WHERE (module IS NULL OR module = '') AND (page_code LIKE '%INTEGRATION%' OR page_code LIKE '%MIGRATION%');
-- Catch remaining nulls
UPDATE page_catalog SET module = 'Admin' WHERE module IS NULL OR module = '';

-- ─── Step 2: Fix known bad paths ──────────────────────────────────────────────
-- WORKFORCE_COMMAND_CENTER was seeded with a wrong path by 216_missing_page_catalog_entries.sql
UPDATE page_catalog
SET page_path = '/performance/command-center'
WHERE page_code = 'WORKFORCE_COMMAND_CENTER'
  AND page_path != '/performance/command-center';

-- Retire ADVANCED_REPORTS — it is a bare redirect stub, not a real page
UPDATE page_catalog SET active_status = 0
WHERE page_code = 'ADVANCED_REPORTS' AND active_status = 1;

-- ─── Step 3: Add missing pages for all active frontend routes ─────────────────
-- Uses INSERT IGNORE so existing rows are untouched.

INSERT IGNORE INTO page_catalog (id, page_code, page_name, page_path, module, active_status) VALUES
  -- Dashboards
  (UUID(), 'CEO_DASHBOARD',             'CEO Dashboard',                '/ceo/dashboard',                'Dashboards', 1),
  (UUID(), 'HR_DASHBOARD',              'HR Dashboard',                 '/hr/dashboard',                 'Dashboards', 1),
  (UUID(), 'MANAGER_DASHBOARD',         'Manager Dashboard',            '/manager/dashboard',            'Dashboards', 1),
  (UUID(), 'BRANCH_HEAD_DASHBOARD',     'Branch Head Dashboard',        '/branch/dashboard',             'Dashboards', 1),
  (UUID(), 'OPERATIONS_DASHBOARD',      'Operations Dashboard',         '/operations/dashboard',         'Dashboards', 1),
  (UUID(), 'RECRUITMENT_DASHBOARD',     'Recruitment Dashboard',        '/ats/dashboard',                'Dashboards', 1),
  -- Employees
  (UUID(), 'EMPLOYEE_DIRECTORY',        'Employee Directory',           '/employees',                    'Employees', 1),
  (UUID(), 'EMPLOYEE_PROFILE',          'Employee Profile',             '/employees/:id',                'Employees', 1),
  (UUID(), 'EMPLOYEE_ONBOARDING',       'Employee Onboarding',         '/onboarding',                   'Employees', 1),
  (UUID(), 'EMPLOYEE_DOCUMENTS',        'Employee Documents',           '/employees/documents',          'Employees', 1),
  (UUID(), 'EMPLOYEE_ASSETS',           'Employee Assets',              '/employees/assets',             'Employees', 1),
  (UUID(), 'BULK_UPLOAD',               'Bulk Upload',                  '/bulk-upload',                  'Admin',     1),
  -- Attendance
  (UUID(), 'ATTENDANCE_HUB',            'Attendance Hub',               '/attendance',                   'Attendance', 1),
  (UUID(), 'ATTENDANCE_REGULARIZATION', 'Attendance Regularization',    '/attendance/regularization',    'Attendance', 1),
  (UUID(), 'ATTENDANCE_BIOMETRIC',      'Biometric Sync',               '/attendance/biometric',         'Attendance', 1),
  -- Leave
  (UUID(), 'LEAVE_MANAGEMENT',          'Leave Management',             '/leave',                        'Leave', 1),
  (UUID(), 'LEAVE_APPLY',               'Apply Leave',                  '/leave/apply',                  'Leave', 1),
  (UUID(), 'LEAVE_POLICY',              'Leave Policy',                 '/leave/policy',                 'Leave', 1),
  (UUID(), 'LEAVE_CALENDAR',            'Leave Calendar',               '/leave/calendar',               'Leave', 1),
  -- WFM
  (UUID(), 'ROSTER_MANAGEMENT',         'Roster Management',            '/wfm/roster',                   'WFM', 1),
  (UUID(), 'SHIFT_MANAGEMENT',          'Shift Management',             '/wfm/shifts',                   'WFM', 1),
  (UUID(), 'WFM_LIVE_TRACKER',          'WFM Live Tracker',             '/wfm/live',                     'WFM', 1),
  (UUID(), 'WORKFORCE_FORECASTING',     'Workforce Forecasting',        '/wfm/forecasting',              'WFM', 1),
  -- Payroll (supplement — primary rows exist in 538_ migration)
  (UUID(), 'PAYROLL_DASHBOARD',         'Payroll Dashboard',            '/payroll/dashboard',            'Payroll', 1),
  (UUID(), 'SALARY_SLIPS',              'Salary Slips',                 '/payroll/salary-slips',         'Payroll', 1),
  (UUID(), 'STATUTORY_COMPLIANCE',      'Statutory Compliance',         '/payroll/statutory',            'Payroll', 1),
  (UUID(), 'GRATUITY',                  'Gratuity',                     '/payroll/gratuity',             'Payroll', 1),
  (UUID(), 'FULL_AND_FINAL',            'Full & Final Settlement',      '/payroll/fnf',                  'Payroll', 1),
  (UUID(), 'TAX_DECLARATION',           'Tax Declaration',              '/payroll/tax-declaration',      'Payroll', 1),
  -- Quality
  (UUID(), 'QUALITY_DASHBOARD',         'Quality Dashboard',            '/quality/dashboard',            'Quality', 1),
  (UUID(), 'QA_AUDIT',                  'QA Audit',                     '/quality/audit',                'Quality', 1),
  (UUID(), 'PERFORMANCE_COMMAND_CENTER','Performance Command Center',   '/performance/command-center',   'Quality', 1),
  -- Reports
  (UUID(), 'REPORTS_CENTER',            'Reports Center',               '/reports',                      'Reports', 1),
  -- LMS
  (UUID(), 'LMS_DASHBOARD',             'LMS Dashboard',                '/lms/dashboard',                'LMS', 1),
  (UUID(), 'LMS_LEARNER',               'My Learning',                  '/lms/my-learning',              'LMS', 1),
  (UUID(), 'LMS_ADMIN',                 'LMS Admin',                    '/lms/admin',                    'LMS', 1),
  -- Access
  (UUID(), 'ACCESS_CONTROL',            'Access Control',               '/settings/access-control',      'Access', 1),
  -- Settings
  (UUID(), 'SETTINGS',                  'Settings',                     '/settings',                     'Settings', 1),
  (UUID(), 'COMPANY_PROFILE',           'Company Profile',              '/settings/company',             'Settings', 1),
  (UUID(), 'NOTIFICATION_PREFERENCES', 'Notification Preferences',     '/settings/notifications',       'Settings', 1),
  -- Exit
  (UUID(), 'EXIT_MANAGEMENT',           'Exit Management',              '/exit',                         'Exit', 1),
  (UUID(), 'RESIGNATION_REQUESTS',      'Resignation Requests',         '/exit/resignations',            'Exit', 1),
  (UUID(), 'FNF_SETTLEMENT',            'F&F Settlement',               '/exit/fnf',                     'Exit', 1),
  -- Client Portal
  (UUID(), 'CLIENT_PORTAL',             'Client Portal',                '/client-portal',                'Client Portal', 1),
  (UUID(), 'CLIENT_PORTAL_PERFORMANCE', 'Client Portal Performance',    '/client-portal/performance',    'Client Portal', 1),
  -- Integrations
  (UUID(), 'INTEGRATION_HUB',           'Integration Hub',              '/integrations',                 'Integrations', 1),
  (UUID(), 'MIGRATION_CONSOLE',         'Migration Console',            '/integrations/migration',       'Integrations', 1),
  -- Finance
  (UUID(), 'FINANCE_DASHBOARD',         'Finance Dashboard',            '/finance/dashboard',            'Finance', 1),
  (UUID(), 'EXPENSE_MANAGEMENT',        'Expense Management',           '/finance/expenses',             'Finance', 1);

-- ─── Step 4: Backfill super_admin with full access on all new pages ────────────
-- Same idempotent pattern as 538_route_page_access_backfill.sql
INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT 'super_admin', pc.page_code, 1, 1, 1, 1, 1, 1
FROM page_catalog pc
WHERE pc.active_status = 1
  AND NOT EXISTS (
    SELECT 1 FROM role_page_access rpa
    WHERE rpa.role_key = 'super_admin' AND rpa.page_code = pc.page_code AND rpa.active_status = 1
  )
ON DUPLICATE KEY UPDATE
  can_view = 1, can_create = 1, can_edit = 1, can_delete = 1, can_export = 1, active_status = 1;

-- ─── Verification query (run after applying) ──────────────────────────────────
-- SELECT module, COUNT(*) AS page_count FROM page_catalog WHERE active_status = 1 GROUP BY module ORDER BY module;
