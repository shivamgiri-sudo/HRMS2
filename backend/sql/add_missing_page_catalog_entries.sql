-- =====================================================
-- Add Missing Page Catalog Entries - Phase 1
-- Date: 2026-07-14
-- Purpose: Add 18 critical missing pages to page_catalog
--          and grant default role permissions
-- =====================================================

-- Insert missing page catalog entries
-- ON DUPLICATE KEY UPDATE ensures idempotency
INSERT INTO page_catalog (page_code, page_name, module, active_status) VALUES
  -- Expenses Module
  ('MY_EXPENSES', 'My Expenses', 'Expenses', 1),
  ('EXPENSE_CREATE', 'New Expense Claim', 'Expenses', 1),
  ('EXPENSE_APPROVALS', 'Expense Approvals', 'Expenses', 1),
  ('EXPENSE_FINANCE', 'Finance Queue', 'Expenses', 1),
  ('EXPENSE_REPORTS', 'Expense Reports', 'Expenses', 1),

  -- Role Dashboards
  ('EMPLOYEE_DASHBOARD', 'Employee Dashboard', 'Overview', 1),
  ('CEO_DASHBOARD', 'CEO Dashboard', 'Overview', 1),
  ('HR_DASHBOARD', 'HR Dashboard', 'Overview', 1),
  ('WFM_DASHBOARD', 'WFM Dashboard', 'Overview', 1),
  ('PAYROLL_DASHBOARD', 'Payroll Dashboard', 'Overview', 1),
  ('MANAGER_DASHBOARD', 'Manager Dashboard', 'Overview', 1),

  -- Critical Payroll Pages
  ('PAYROLL_DISBURSAL', 'Disbursal Management', 'Payroll', 1),
  ('PAYROLL_LOANS', 'Loan Management', 'Payroll', 1),
  ('SALARY_CERTIFICATE', 'Salary Certificates', 'Payroll', 1),

  -- Super Admin Pages
  ('MODULE_ACCESS', 'Module Access', 'Admin', 1),
  ('SUPER_ADMIN_DASHBOARD', 'Super Admin Dashboard', 'Admin', 1),
  ('SECURITY_CENTER', 'Security Center', 'Admin', 1)
ON DUPLICATE KEY UPDATE active_status = 1;

-- Grant default role permissions
-- ON DUPLICATE KEY UPDATE ensures idempotency
INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export) VALUES
  -- Expenses - Employee access
  ('employee', 'MY_EXPENSES', 1, 1, 1, 0, 0),
  ('employee', 'EXPENSE_CREATE', 1, 1, 0, 0, 0),

  -- Expenses - Manager access
  ('manager', 'EXPENSE_APPROVALS', 1, 0, 1, 0, 0),
  ('process_manager', 'EXPENSE_APPROVALS', 1, 0, 1, 0, 0),

  -- Expenses - Finance access
  ('finance', 'EXPENSE_FINANCE', 1, 0, 1, 0, 1),
  ('finance', 'EXPENSE_REPORTS', 1, 0, 0, 0, 1),

  -- Expenses - Admin access
  ('admin', 'EXPENSE_APPROVALS', 1, 0, 1, 0, 0),
  ('admin', 'EXPENSE_FINANCE', 1, 0, 1, 0, 1),
  ('admin', 'EXPENSE_REPORTS', 1, 0, 0, 0, 1),
  ('admin', 'MY_EXPENSES', 1, 1, 1, 0, 0),

  -- Employee Dashboard
  ('employee', 'EMPLOYEE_DASHBOARD', 1, 0, 0, 0, 0),

  -- Role-specific Dashboards
  ('ceo', 'CEO_DASHBOARD', 1, 0, 0, 0, 1),
  ('hr', 'HR_DASHBOARD', 1, 0, 0, 0, 1),
  ('admin', 'HR_DASHBOARD', 1, 0, 0, 0, 1),
  ('wfm', 'WFM_DASHBOARD', 1, 0, 0, 0, 1),
  ('payroll_head', 'PAYROLL_DASHBOARD', 1, 0, 0, 0, 1),
  ('payroll', 'PAYROLL_DASHBOARD', 1, 0, 0, 0, 0),
  ('manager', 'MANAGER_DASHBOARD', 1, 0, 0, 0, 1),
  ('process_manager', 'MANAGER_DASHBOARD', 1, 0, 0, 0, 1),

  -- Salary Certificates - Employee access
  ('employee', 'SALARY_CERTIFICATE', 1, 1, 0, 0, 0),

  -- Payroll - Finance access
  ('finance', 'PAYROLL_DISBURSAL', 1, 0, 1, 0, 1),

  -- Payroll - Payroll Head access
  ('payroll_head', 'PAYROLL_DISBURSAL', 1, 1, 1, 0, 1),
  ('payroll_head', 'PAYROLL_LOANS', 1, 1, 1, 0, 1),

  -- Payroll - HR access
  ('hr', 'PAYROLL_LOANS', 1, 0, 1, 0, 0),

  -- Super Admin - Full access
  ('super_admin', 'MODULE_ACCESS', 1, 1, 1, 1, 1),
  ('super_admin', 'SUPER_ADMIN_DASHBOARD', 1, 0, 0, 0, 1),
  ('super_admin', 'SECURITY_CENTER', 1, 1, 1, 0, 1),
  ('super_admin', 'PAYROLL_DISBURSAL', 1, 1, 1, 0, 1),
  ('super_admin', 'PAYROLL_LOANS', 1, 1, 1, 0, 1),

  -- Admin - Security Center view access
  ('admin', 'SECURITY_CENTER', 1, 0, 0, 0, 0)
ON DUPLICATE KEY UPDATE can_view = 1;

-- Verification query (optional - run manually to verify)
-- SELECT pc.page_code, pc.page_name, pc.module, pc.active_status,
--        rpa.role_key, rpa.can_view, rpa.can_create, rpa.can_edit
-- FROM page_catalog pc
-- LEFT JOIN role_page_access rpa ON pc.page_code = rpa.page_code
-- WHERE pc.page_code IN (
--   'MY_EXPENSES', 'EXPENSE_CREATE', 'EXPENSE_APPROVALS', 'EXPENSE_FINANCE', 'EXPENSE_REPORTS',
--   'EMPLOYEE_DASHBOARD', 'CEO_DASHBOARD', 'HR_DASHBOARD', 'WFM_DASHBOARD', 'PAYROLL_DASHBOARD', 'MANAGER_DASHBOARD',
--   'PAYROLL_DISBURSAL', 'PAYROLL_LOANS', 'SALARY_CERTIFICATE',
--   'MODULE_ACCESS', 'SUPER_ADMIN_DASHBOARD', 'SECURITY_CENTER'
-- )
-- ORDER BY pc.module, pc.page_code, rpa.role_key;
