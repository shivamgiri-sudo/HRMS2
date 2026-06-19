-- 216_missing_page_catalog_entries.sql
-- Ensure all dashboard page codes referenced in role_page_access exist in page_catalog
-- Fixes /operations/dashboard (and others) showing "Access not available" for super_admin

USE mas_hrms;

INSERT INTO page_catalog (page_code, page_name, module, page_path, description) VALUES
('OPERATIONS_DASHBOARD',   'Operations Dashboard',   'Operations', '/operations/dashboard',   'Real-time workforce visibility and operations command center'),
('QUALITY_DASHBOARD',      'Quality Dashboard',      'Quality',    '/quality/dashboard',      'Call quality analytics and agent performance'),
('CONTROL_TOWER',          'Control Tower',          'Operations', '/control-tower',          'Enterprise control tower for cross-module monitoring'),
('MANAGEMENT_DASHBOARD',   'Management Dashboard',   'Management', '/management/dashboard',   'Management insights and team performance overview'),
('OPERATIONS_KPI',         'Operations KPI',         'Operations', '/operations-kpi',         'Operations KPI and analyst performance metrics'),
('PERFORMANCE_DASHBOARD',  'Performance Dashboard',  'Operations', '/performance/dashboard',  'Individual and team performance dashboard'),
('ATS_DASHBOARD',          'ATS Dashboard',          'ATS',        '/ats/command-center',     'Applicant tracking system command center'),
('ATS_RECRUITER_QUEUE',    'Recruiter Queue',        'ATS',        '/ats/recruiter-queue',    'Recruiter task and candidate queue'),
('WORKFORCE_COMMAND_CENTER','Workforce Command Center','Workforce', '/workforce/command-center','Live workforce visibility and planning'),
('WFM_LIVE_TRACKER',       'Live Tracker',           'WFM',        '/live-tracker',           'Real-time employee status tracker'),
('WFM_ROSTER',             'Roster',                 'WFM',        '/roster',                 'Shift roster management'),
('KPI_DASHBOARD',          'KPI Dashboard',          'KPI',        '/kpi/dashboard',          'Key performance indicators dashboard'),
('LEAVE_MANAGEMENT',       'Leave Management',       'HR',         '/leave/dashboard',        'Leave requests and approvals'),
('SALARY_PREP',            'Salary Prep',            'Payroll',    '/salary-prep',            'Salary preparation and processing'),
('ACCESS_CONTROL',         'Access Control',         'Admin',      '/super-admin/page-access','User page access management'),
('DIALER_INTEGRATION',     'Dialer Integration',     'Integrations','/integration-hub',       'Dialer system integration hub'),
('INTEGRATION_HUB',        'Integration Hub',        'Integrations','/integration-hub',       'Enterprise integration hub'),
('MIGRATION_CONSOLE',      'Migration Console',      'Admin',      '/migration',              'Data migration management'),
('ISPARK_MIGRATION',       'iSpark Migration',       'Admin',      '/ispark',                 'iSpark data migration'),
('COACHING',               'Coaching Center',        'Management', '/team/coaching',          'Team coaching and feedback'),
('TEAM_ROSTER',            'Team Roster',            'Management', '/team/roster',            'View and manage team roster'),
('TEAM_ATTENDANCE',        'Team Attendance',        'Management', '/team/attendance',        'Monitor team attendance'),
('MANAGEMENT_DASHBOARD',   'Management Dashboard',   'Management', '/management/dashboard',   'Manager dashboard with team insights'),
('ATS_ONBOARDING_BRIDGE',  'ATS Onboarding Bridge',  'ATS',        '/onboarding',             'Candidate to employee onboarding bridge'),
('WEEK_OFF_PREFERENCES',   'Week-Off Preferences',   'WFM',        '/week-off-preferences',   'Employee week-off preference management')
ON DUPLICATE KEY UPDATE
  page_name = VALUES(page_name),
  module = VALUES(module),
  page_path = VALUES(page_path),
  description = VALUES(description);

-- Also ensure super_admin role has explicit access to all operations/quality pages
INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export) VALUES
('super_admin','OPERATIONS_DASHBOARD',  1,1,1,1,1),
('super_admin','QUALITY_DASHBOARD',     1,1,1,1,1),
('super_admin','CONTROL_TOWER',         1,1,1,1,1),
('super_admin','OPERATIONS_KPI',        1,1,1,1,1),
('super_admin','PERFORMANCE_DASHBOARD', 1,1,1,1,1),
('super_admin','MANAGEMENT_DASHBOARD',  1,1,1,1,1)
ON DUPLICATE KEY UPDATE can_view=1, can_create=1, can_edit=1, can_delete=1, can_export=1;
