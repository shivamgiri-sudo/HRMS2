-- Migration 297: Remaining Workflow Page Access Grants
-- Registers all dashboard and workflow page codes in page_catalog
-- Grants super_admin full access to all new page codes from migrations 291-297
-- Safe to re-run: INSERT IGNORE throughout

-- Dashboard page codes
INSERT IGNORE INTO page_catalog (id, page_code, page_name, module, description, active_status)
VALUES
  (UUID(), 'CEO_DASHBOARD',              'CEO Dashboard',              'dashboards', 'Executive command dashboard', 1),
  (UUID(), 'BRANCH_HEAD_DASHBOARD',      'Branch Head Dashboard',      'dashboards', 'Branch operations dashboard', 1),
  (UUID(), 'PROCESS_MANAGER_DASHBOARD',  'Process Manager Dashboard',  'dashboards', 'Process team dashboard', 1),
  (UUID(), 'OPERATIONS_HEAD_DASHBOARD',  'Operations Head Dashboard',  'dashboards', 'Operations command dashboard', 1),
  (UUID(), 'FINANCE_HEAD_DASHBOARD',     'Finance Dashboard',          'dashboards', 'Finance and payroll dashboard', 1),
  (UUID(), 'PAYROLL_HR_DASHBOARD',       'Payroll HR Dashboard',       'dashboards', 'Payroll HR validation dashboard', 1),
  (UUID(), 'HR_DASHBOARD',               'HR Dashboard',               'dashboards', 'HR operations dashboard', 1),
  (UUID(), 'WFM_DASHBOARD',              'WFM Dashboard',              'dashboards', 'Workforce management dashboard', 1),
  (UUID(), 'PROVISIONING_DASHBOARD',     'Provisioning Dashboard',     'dashboards', 'IT provisioning status dashboard', 1),
  (UUID(), 'COMPLIANCE_DASHBOARD',       'Compliance Dashboard',       'dashboards', 'DPDP and statutory compliance dashboard', 1),
  (UUID(), 'RECRUITER_DASHBOARD',        'Recruiter Dashboard',        'dashboards', 'ATS recruiter metrics dashboard', 1),
  (UUID(), 'EMPLOYEE_SELF_DASHBOARD',    'My Dashboard',               'dashboards', 'Employee self-service dashboard', 1);

-- Grant super_admin full access to all new page codes from migrations 290-297
INSERT IGNORE INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
SELECT UUID(), 'super_admin', page_code, 1, 1, 1, 1, 1, 1
FROM page_catalog
WHERE page_code IN (
  -- Incentive (291)
  'PAYROLL_INCENTIVE_UPLOAD',
  'PAYROLL_INCENTIVE_APPROVALS',
  'PAYROLL_INCENTIVE_REGISTER',
  -- E-Sign (292)
  'APPOINTMENT_ESIGN',
  -- DPDP (293)
  'DPDP_WITHDRAWAL',
  'DPDP_WITHDRAWAL_ADMIN',
  -- TAT (294)
  'TAT_MATRIX',
  'TAT_DASHBOARD',
  -- Name matrix (295)
  'NAME_CONSISTENCY_MATRIX',
  -- Resignation (296)
  'RESIGNATION_MY_REQUEST',
  'RESIGNATION_COMMAND_CENTER',
  -- Dashboards (297)
  'CEO_DASHBOARD',
  'BRANCH_HEAD_DASHBOARD',
  'PROCESS_MANAGER_DASHBOARD',
  'OPERATIONS_HEAD_DASHBOARD',
  'FINANCE_HEAD_DASHBOARD',
  'PAYROLL_HR_DASHBOARD',
  'HR_DASHBOARD',
  'WFM_DASHBOARD',
  'PROVISIONING_DASHBOARD',
  'COMPLIANCE_DASHBOARD',
  'RECRUITER_DASHBOARD',
  'EMPLOYEE_SELF_DASHBOARD'
);
