-- 170_access_improvements.sql
-- Fixes all 16 access control issues identified in audit:
--   A1. expires_at on user_page_access (time-bounded access)
--   A2. designation_role_map (designation → role auto-assignment)
--   A3. access_requests (employee access request workflow)
--   A4. Full page_catalog seed — every pageCode used in App.tsx Gates
--   A5. role_page_access seed for KPI_MASTER and MY_KPI
USE mas_hrms;

-- ============================================================================
-- A1. Add expires_at column to user_page_access (idempotent)
-- ============================================================================

ALTER TABLE user_page_access
  ADD COLUMN IF NOT EXISTS expires_at DATETIME NULL
    COMMENT 'NULL = permanent access; set to auto-expire at this timestamp'
  AFTER active_status;

-- ============================================================================
-- A1b. Seed assistant_manager into workforce_role_catalog if not present
--      (required before role_page_access or designation_role_map FK references it)
-- ============================================================================

INSERT IGNORE INTO workforce_role_catalog (role_key, role_name, description)
VALUES ('assistant_manager', 'Assistant Manager', 'Assistant-level operations manager');

-- ============================================================================
-- A2. Designation → Role auto-assignment map
-- ============================================================================

CREATE TABLE IF NOT EXISTS designation_role_map (
  id             CHAR(36)     NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  designation_id CHAR(36)     NOT NULL,
  role_key       VARCHAR(100) NOT NULL,
  active_status  TINYINT(1)   NOT NULL DEFAULT 1,
  created_by     CHAR(36)     NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_desig_role (designation_id, role_key),
  INDEX idx_drm_designation (designation_id),
  INDEX idx_drm_role (role_key),
  FOREIGN KEY (role_key) REFERENCES workforce_role_catalog(role_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Maps designations to roles — when an employee designation changes, mapped roles are auto-assigned';

-- ============================================================================
-- A3. Access request workflow table
-- ============================================================================

CREATE TABLE IF NOT EXISTS access_requests (
  id          CHAR(36)                              NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  user_id     CHAR(36)                              NOT NULL,
  page_code   VARCHAR(100)                          NOT NULL,
  reason      TEXT                                  NULL,
  status      ENUM('pending','approved','denied')   NOT NULL DEFAULT 'pending',
  reviewed_by CHAR(36)                              NULL,
  reviewed_at DATETIME                              NULL,
  review_note TEXT                                  NULL,
  created_at  DATETIME                              NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ar_user (user_id),
  INDEX idx_ar_status (status),
  INDEX idx_ar_page (page_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Employee requests for page access — admin approves/denies via UnifiedAccessControl';

-- ============================================================================
-- A4. Seed ALL page codes used in App.tsx WorkforcePageGate wrappers
-- ============================================================================

INSERT INTO page_catalog (page_code, page_name, module, page_path, description) VALUES
-- KPI (newly gated)
('KPI_MASTER',              'KPI Master Config',          'KPI',          '/kpi-master',                  'Define and manage KPIs by org unit'),
('MY_KPI',                  'My KPI Dashboard',           'KPI',          '/my-kpi',                      'Personal live KPI performance dashboard'),
-- Employee / HR (newly gated)
('EMPLOYEE_MANAGEMENT',     'Employee Management',        'HR',           '/employees',                   'Full employee directory and management'),
('PAYROLL',                 'Payroll',                    'Payroll',      '/payroll',                     'Payroll processing and run management'),
('ATTENDANCE_REGULARIZATION','Attendance Regularization', 'Attendance',   '/attendance-regularization',   'Approve or correct attendance records'),
-- ATS additional
('ATS_OFFER',               'ATS Offer Management',       'ATS',          '/ats/offer-approvals',         'Manage and approve candidate offers'),
('ATS_ONBOARDING_BRIDGE',   'ATS Onboarding Bridge',      'ATS',          '/ats/onboarding-bridge',       'Bridge candidate to employee onboarding'),
('ATS_WAITING_QUEUE',       'ATS Waiting Queue',          'ATS',          '/ats/waiting-queue',           'Walk-in candidate waiting queue'),
('ATS_CANDIDATE_MASTER',    'ATS Candidate Master',       'ATS',          '/ats/candidate-master',        'Full candidate database'),
('ATS_RECRUITER_WORKSPACE', 'Recruiter Workspace',        'ATS',          '/ats/recruiter/workspace',     'Recruiter workspace and pipeline'),
('ATS_EXTENSIONS',          'ATS Extensions',             'ATS',          '/ats/extensions',              'ATS extension modules'),
('ATS_BGV',                 'BGV Verification Center',    'ATS',          '/ats/bgv',                     'Background verification center'),
('ATS_RECRUITER_PORTAL',    'Recruiter Portal',           'ATS',          '/ats/recruiter-portal',        'External recruiter portal'),
('ATS_PAYROLL_HR',          'ATS Payroll HR Validation',  'ATS',          '/ats/payroll-hr-validation',   'HR validation before payroll'),
('ATS_WALKIN_QUEUE',        'Walk-in Queue',              'ATS',          '/ats/walkin-queue',            'Walk-in candidate registration queue'),
('ATS_BRANCH_HEAD_APPROVAL','Branch Head Approval',       'ATS',          '/ats/branch-head-approval',    'Branch head offer/joining approvals'),
-- WFM additional
('WFM_EXTENSIONS',          'WFM Extensions',             'WFM',          '/wfm/extensions',              'WFM extension modules'),
('WFM_AUTO_ROSTER',         'Auto Roster',                'WFM',          '/wfm/auto-roster',             'Automated roster generation'),
-- LMS additional
('LMS_INTEGRATION',         'LMS Integration',            'LMS',          '/lms/integration',             'LMS integration management'),
-- Engagement
('ENGAGEMENT_COMMAND_CENTER','Engagement Command Center', 'Engagement',   '/engagement/command-center',   'Engagement module admin'),
-- HR Ops
('HELPDESK',                'Helpdesk',                   'Support',      '/helpdesk',                    'Employee helpdesk tickets'),
('LETTERS',                 'Letters',                    'HR',           '/letters',                     'HR letter generation'),
('EMPLOYEE_LIFECYCLE',      'Employee Lifecycle',         'HR',           '/employee-lifecycle',          'Employee lifecycle management'),
('WORKFLOW_ADMIN',          'Workflow Admin',             'Admin',        '/workflow-admin',              'Business workflow configuration'),
('BENEFITS',                'Benefits & Claims',          'HR',           '/benefits',                    'Employee benefits and claims'),
('CAREER_PLANNING',         'Career Planning',            'HR',           '/career-planning',             'Career development planning'),
('PIP_MANAGEMENT',          'PIP Management',             'HR',           '/pip-management',              'Performance improvement plans'),
('ERP',                     'ERP',                        'Finance',      '/erp',                         'ERP integration module'),
('GOALS',                   'Goals & Appraisal',          'Performance',  '/goals',                       'Goals and appraisal management'),
('WORK_INBOX',              'Work Inbox',                 'System',       '/work-inbox',                  'Pending actions and approvals'),
('MOBILITY',                'Mobility Management',        'HR',           '/mobility',                    'Employee transfers and mobility'),
('JOBS_PORTAL',             'Jobs Portal',                'ATS',          '/jobs',                        'Internal jobs portal'),
('ADVANCED_REPORTS',        'Advanced Reports',           'Reports',      '/advanced-reports',            'Advanced reporting and analytics'),
('STATUTORY_COMPLIANCE',    'Statutory Compliance',       'Compliance',   '/compliance/statutory',        'Statutory compliance management'),
('LABOUR_COMPLIANCE',       'Labour Compliance',          'Compliance',   '/compliance/labour',           'Labour law compliance'),
('DPDP_COMPLIANCE',         'DPDP Compliance',            'Compliance',   '/compliance/dpdp',             'Data protection compliance'),
('CLIENT_MASTER',           'Client Master',              'Operations',   '/client-master',               'Client master data management'),
('CUSTOMIZATION_MANAGER',   'Customization Manager',      'Admin',        '/customization',               'System customization rules'),
('EXIT_COMMAND_CENTER',     'Exit Command Center',        'HR',           '/exit/command-center',         'Exit management command center'),
('KPI_CONFIG',              'KPI Configuration',          'KPI',          '/kpi-config',                  'KPI configuration settings'),
('OPERATIONS_KPI',          'Operations KPI',             'Operations',   '/operations-kpi',              'Operations KPI dashboard'),
('PORTAL_DATA_MANAGER',     'Portal Data Manager',        'Portal',       '/portal-data-manager',         'Client portal data management'),
('PROCESS_CONFIG',          'Process Config',             'Operations',   '/process-config',              'Process configuration'),
('LEAVE_TYPES',             'Leave Types Config',         'HR',           '/leave-types',                 'Leave type configuration'),
('ROSTER_MASTER',           'Roster Master',              'WFM',          '/roster-master-builder',       'Roster master builder and capacity'),
('CONTROL_TOWER',           'Control Tower',              'WFM',          '/control-tower',               'Operations control tower'),
('RTA_BOARD',               'RTA Board',                  'WFM',          '/rta-board',                   'Real-time adherence board'),
('ASSETS_MANAGER',          'Assets Manager',             'HR',           '/assets-manager',              'Asset assignment management'),
('ORG_MASTERS',             'Org Masters',                'Admin',        '/org-masters',                 'Organisation master data'),
('MANAGEMENT_DASHBOARD',    'Management Dashboard',       'Management',   '/management/dashboard',        'Management overview dashboard'),
('ACCESS_CONTROL',          'Access Control',             'Admin',        '/settings/access-control',     'User and role access management'),
('WORKFORCE_COMMAND_CENTER','Workforce Command Center',   'Performance',  '/performance/command-center',  'Unified performance command center'),
('QUALITY_DASHBOARD',       'Quality Dashboard',          'Quality',      '/quality/dashboard',           'Quality performance dashboard'),
('OPERATIONS_DASHBOARD',    'Operations Dashboard',       'Operations',   '/operations/dashboard',        'Operations performance dashboard'),
('WFM_ROSTER',              'WFM Roster',                 'WFM',          '/wfm/roster',                  'Workforce roster planning'),
('WFM_LIVE_TRACKER',        'WFM Live Tracker',           'WFM',          '/wfm/live-tracker',            'Live workforce tracker'),
('LMS_MY_LEARNING',         'My Learning',                'LMS',          '/lms/my-learning',             'Personal learning dashboard'),
('LMS_COORDINATOR',         'LMS Coordinator',            'LMS',          '/lms/coordinator',             'LMS coordination and batch management'),
('LMS_ADMIN',               'LMS Admin',                  'LMS',          '/lms/admin',                   'LMS administration'),
('LMS_MANAGEMENT_DASHBOARD','LMS Management Dashboard',   'LMS',          '/lms/management-dashboard',    'LMS management overview'),
('ATS_DASHBOARD',           'ATS Dashboard',              'ATS',          '/ats/dashboard',               'ATS main dashboard'),
('ATS_RECRUITER_QUEUE',     'Recruiter Queue',            'ATS',          '/ats/recruiter/my-candidates', 'Recruiter candidate queue'),
('PAYROLL_PAYSLIPS',        'Payslips',                   'Payroll',      '/payroll/payslips',            'Employee payslip center'),
('TAX_DECLARATION',         'Tax Declaration',            'Payroll',      '/payroll/tax-declaration',     'Investment/tax declaration'),
('FULL_FINAL',              'Full & Final',               'Payroll',      '/payroll/full-final',          'Full and final settlement'),
('STATUTORY_CONFIG',        'Statutory Config',           'Payroll',      '/payroll/statutory-config',    'Statutory configuration'),
('PAYROLL_MASTERS',         'Payroll Masters',            'Payroll',      '/payroll/masters',             'Payroll master configuration'),
('SALARY_PACKAGES',         'Salary Packages',            'Payroll',      '/payroll/salary-packages',     'Salary band and package config'),
('PAYROLL_INCENTIVES',      'Payroll Incentives',         'Payroll',      '/payroll/incentives',          'Incentive upload and approval'),
('INTEGRATION_HUB',         'Integration Hub',            'Admin',        '/integration-hub',             'External system integration hub')
ON DUPLICATE KEY UPDATE
  page_name   = VALUES(page_name),
  module      = VALUES(module),
  page_path   = VALUES(page_path),
  description = VALUES(description);

-- ============================================================================
-- A5. Seed role_page_access for KPI_MASTER and MY_KPI
-- ============================================================================

INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export) VALUES
-- KPI_MASTER: admin/hr/process_manager/manager edit; qa/ceo view only
('admin',           'KPI_MASTER', 1, 1, 1, 1, 1),
('hr',              'KPI_MASTER', 1, 1, 1, 0, 1),
('process_manager', 'KPI_MASTER', 1, 1, 1, 0, 1),
('manager',         'KPI_MASTER', 1, 1, 1, 0, 1),
('qa',              'KPI_MASTER', 1, 0, 0, 0, 1),
('ceo',             'KPI_MASTER', 1, 0, 0, 0, 1),
('branch_head',     'KPI_MASTER', 1, 0, 0, 0, 1),
-- MY_KPI: every role — personal dashboard
('admin',           'MY_KPI', 1, 0, 0, 0, 0),
('hr',              'MY_KPI', 1, 0, 0, 0, 0),
('process_manager', 'MY_KPI', 1, 0, 0, 0, 0),
('manager',         'MY_KPI', 1, 0, 0, 0, 0),
('assistant_manager','MY_KPI', 1, 0, 0, 0, 0),
('team_leader',     'MY_KPI', 1, 0, 0, 0, 0),
('tl',              'MY_KPI', 1, 0, 0, 0, 0),
('wfm',             'MY_KPI', 1, 0, 0, 0, 0),
('finance',         'MY_KPI', 1, 0, 0, 0, 0),
('payroll',         'MY_KPI', 1, 0, 0, 0, 0),
('qa',              'MY_KPI', 1, 0, 0, 0, 0),
('recruiter',       'MY_KPI', 1, 0, 0, 0, 0),
('trainer',         'MY_KPI', 1, 0, 0, 0, 0),
('employee',        'MY_KPI', 1, 0, 0, 0, 0),
('ceo',             'MY_KPI', 1, 0, 0, 0, 0),
('branch_head',     'MY_KPI', 1, 0, 0, 0, 0),
-- EMPLOYEE_MANAGEMENT: admin/hr full; process_manager/manager/branch_head scoped read
('admin',           'EMPLOYEE_MANAGEMENT', 1, 1, 1, 1, 1),
('hr',              'EMPLOYEE_MANAGEMENT', 1, 1, 1, 0, 1),
('process_manager', 'EMPLOYEE_MANAGEMENT', 1, 0, 0, 0, 1),
('manager',         'EMPLOYEE_MANAGEMENT', 1, 0, 0, 0, 1),
('branch_head',     'EMPLOYEE_MANAGEMENT', 1, 1, 1, 0, 1),
('ceo',             'EMPLOYEE_MANAGEMENT', 1, 0, 0, 0, 1),
-- PAYROLL main page
('admin',           'PAYROLL', 1, 1, 1, 0, 1),
('hr',              'PAYROLL', 1, 0, 1, 0, 1),
('finance',         'PAYROLL', 1, 1, 1, 0, 1),
('payroll',         'PAYROLL', 1, 1, 1, 0, 1),
-- ATTENDANCE_REGULARIZATION
('admin',           'ATTENDANCE_REGULARIZATION', 1, 1, 1, 0, 1),
('hr',              'ATTENDANCE_REGULARIZATION', 1, 1, 1, 0, 1),
('process_manager', 'ATTENDANCE_REGULARIZATION', 1, 1, 1, 0, 1),
('manager',         'ATTENDANCE_REGULARIZATION', 1, 1, 1, 0, 1),
('employee',        'ATTENDANCE_REGULARIZATION', 1, 1, 0, 0, 0),
('team_leader',     'ATTENDANCE_REGULARIZATION', 1, 1, 1, 0, 0),
('tl',              'ATTENDANCE_REGULARIZATION', 1, 1, 1, 0, 0),
-- ATS routes
('admin',           'ATS_OFFER', 1, 1, 1, 1, 1),
('hr',              'ATS_OFFER', 1, 1, 1, 0, 1),
('recruiter',       'ATS_OFFER', 1, 1, 1, 0, 1),
('branch_head',     'ATS_OFFER', 1, 0, 1, 0, 1),
('admin',           'ATS_ONBOARDING_BRIDGE', 1, 1, 1, 0, 1),
('hr',              'ATS_ONBOARDING_BRIDGE', 1, 1, 1, 0, 1),
('recruiter',       'ATS_ONBOARDING_BRIDGE', 1, 1, 1, 0, 1),
('admin',           'ATS_WAITING_QUEUE', 1, 1, 1, 0, 1),
('hr',              'ATS_WAITING_QUEUE', 1, 1, 1, 0, 1),
('recruiter',       'ATS_WAITING_QUEUE', 1, 1, 1, 0, 1),
('admin',           'ATS_CANDIDATE_MASTER', 1, 1, 1, 1, 1),
('hr',              'ATS_CANDIDATE_MASTER', 1, 1, 1, 0, 1),
('recruiter',       'ATS_CANDIDATE_MASTER', 1, 1, 1, 1, 1),
('branch_head',     'ATS_CANDIDATE_MASTER', 1, 0, 0, 0, 1),
('admin',           'ATS_RECRUITER_WORKSPACE', 1, 1, 1, 0, 1),
('hr',              'ATS_RECRUITER_WORKSPACE', 1, 1, 1, 0, 1),
('recruiter',       'ATS_RECRUITER_WORKSPACE', 1, 1, 1, 1, 1),
('admin',           'ATS_EXTENSIONS', 1, 1, 1, 1, 1),
('hr',              'ATS_EXTENSIONS', 1, 1, 1, 0, 1),
('admin',           'ATS_BGV', 1, 1, 1, 1, 1),
('hr',              'ATS_BGV', 1, 1, 1, 0, 1),
('admin',           'ATS_RECRUITER_PORTAL', 1, 1, 1, 0, 1),
('hr',              'ATS_RECRUITER_PORTAL', 1, 1, 1, 0, 1),
('recruiter',       'ATS_RECRUITER_PORTAL', 1, 1, 1, 0, 1),
('admin',           'ATS_PAYROLL_HR', 1, 1, 1, 0, 1),
('hr',              'ATS_PAYROLL_HR', 1, 1, 1, 0, 1),
('admin',           'ATS_WALKIN_QUEUE', 1, 1, 1, 0, 1),
('hr',              'ATS_WALKIN_QUEUE', 1, 1, 1, 0, 1),
('recruiter',       'ATS_WALKIN_QUEUE', 1, 1, 1, 0, 1),
('admin',           'ATS_BRANCH_HEAD_APPROVAL', 1, 1, 1, 0, 1),
('hr',              'ATS_BRANCH_HEAD_APPROVAL', 1, 1, 1, 0, 1),
('branch_head',     'ATS_BRANCH_HEAD_APPROVAL', 1, 0, 1, 0, 1)
ON DUPLICATE KEY UPDATE
  can_view   = VALUES(can_view),
  can_create = VALUES(can_create),
  can_edit   = VALUES(can_edit),
  can_delete = VALUES(can_delete),
  can_export = VALUES(can_export),
  active_status = 1;

-- Ensure all existing entries remain active
UPDATE role_page_access SET active_status = 1 WHERE active_status = 0 AND role_key IN (
  'admin','hr','ceo','branch_head','process_manager','manager','assistant_manager',
  'team_leader','tl','wfm','finance','payroll','qa','recruiter','trainer','employee'
) AND page_code IN ('KPI_MASTER','MY_KPI','EMPLOYEE_MANAGEMENT','PAYROLL','ATTENDANCE_REGULARIZATION');
