-- Migration 1644: Configure report permissions for WFM, Payroll, and HR branch roles
-- This populates role_report_permissions to give branch-scoped roles proper report access
-- Applied: 2026-09-01

-- Clear existing permissions for these roles (idempotent)
DELETE FROM role_report_permissions WHERE role_key IN (
  'wfm', 'wfm_manager', 'wfm_head',
  'payroll', 'payroll_hr', 'payroll_head', 'payroll_branch',
  'hr', 'branch_hr', 'hr_branch'
);

-- ============================================================================
-- WFM ROLE PERMISSIONS
-- ============================================================================

-- WFM Core Reports (view + export)
INSERT INTO role_report_permissions (role_key, report_code, can_view, can_export, granted_by) VALUES
('wfm', 'attendance-day-detail', 1, 1, 1),
('wfm', 'attendance-variance', 1, 1, 1),
('wfm', 'late-arrival-report', 1, 1, 1),
('wfm', 'attendance-summary', 1, 1, 1),
('wfm', 'overtime-report', 1, 1, 1),
('wfm', 'shift-adherence', 1, 1, 1),
('wfm', 'leave-impact', 1, 1, 1),
('wfm', 'roster-vs-actual', 1, 1, 1),
('wfm', 'roster-coverage', 1, 1, 1),
('wfm', 'shrinkage-daily', 1, 1, 1),
('wfm', 'break-utilization', 1, 1, 1),
('wfm', 'wo-utilization', 1, 1, 1),
('wfm', 'roster-compliance', 1, 1, 1),
('wfm', 'punch-accuracy', 1, 1, 1),
('wfm', 'break-session-detail', 1, 1, 1),
('wfm', 'break-kiosk-hourly', 1, 1, 1),
('wfm', 'roster-allocation', 1, 1, 1),
('wfm', 'roster-vs-attendance', 1, 1, 1),
('wfm', 'roster-swap-requests', 1, 1, 1),
('wfm', 'roster-exceptions', 1, 1, 1),
('wfm', 'adr-reconciliation', 1, 1, 1),
('wfm', 'headcount-trend', 1, 1, 1),
('wfm', 'employee-directory', 1, 0, 1),
('wfm', 'leave-balance-summary', 1, 0, 1),
('wfm', 'leave-trend-monthly', 1, 1, 1);

-- WFM Manager (same as WFM)
INSERT INTO role_report_permissions (role_key, report_code, can_view, can_export, granted_by)
SELECT 'wfm_manager', report_code, can_view, can_export, granted_by
FROM role_report_permissions WHERE role_key = 'wfm';

-- WFM Head (same as WFM + extra management reports)
INSERT INTO role_report_permissions (role_key, report_code, can_view, can_export, granted_by)
SELECT 'wfm_head', report_code, can_view, can_export, granted_by
FROM role_report_permissions WHERE role_key = 'wfm';

-- ============================================================================
-- PAYROLL ROLE PERMISSIONS
-- ============================================================================

-- Payroll Head (full access to all payroll reports)
INSERT INTO role_report_permissions (role_key, report_code, can_view, can_export, granted_by) VALUES
('payroll_head', 'payroll-population-reconciliation', 1, 1, 1),
('payroll_head', 'payroll-register', 1, 1, 1),
('payroll_head', 'payroll-variance', 1, 1, 1),
('payroll_head', 'payroll-reconciliation', 1, 1, 1),
('payroll_head', 'payroll-readiness-status', 1, 1, 1),
('payroll_head', 'payroll-cost-summary', 1, 1, 1),
('payroll_head', 'pf-challan', 1, 1, 1),
('payroll_head', 'esic-challan', 1, 1, 1),
('payroll_head', 'pt-challan', 1, 1, 1),
('payroll_head', 'tds-computation', 1, 1, 1),
('payroll_head', 'salary-slip-batch', 1, 1, 1),
('payroll_head', 'bank-transfer-file', 1, 1, 1),
('payroll_head', 'lwp-deduction', 1, 1, 1),
('payroll_head', 'ctc-breakup', 1, 1, 1),
('payroll_head', 'salary-revision-history', 1, 1, 1),
('payroll_head', 'employee-salary-master', 1, 1, 1),
('payroll_head', 'headcount-trend', 1, 1, 1),
('payroll_head', 'employee-directory', 1, 1, 1),
('payroll_head', 'attendance-summary', 1, 1, 1),
('payroll_head', 'leave-balance-summary', 1, 1, 1);

-- Payroll HR (same as payroll_head)
INSERT INTO role_report_permissions (role_key, report_code, can_view, can_export, granted_by)
SELECT 'payroll_hr', report_code, can_view, can_export, granted_by
FROM role_report_permissions WHERE role_key = 'payroll_head';

-- Payroll (branch-scoped, same reports)
INSERT INTO role_report_permissions (role_key, report_code, can_view, can_export, granted_by)
SELECT 'payroll', report_code, can_view, can_export, granted_by
FROM role_report_permissions WHERE role_key = 'payroll_head';

-- Payroll Branch (branch-scoped, view + limited export)
INSERT INTO role_report_permissions (role_key, report_code, can_view, can_export, granted_by) VALUES
('payroll_branch', 'payroll-register', 1, 1, 1),
('payroll_branch', 'payroll-cost-summary', 1, 0, 1),
('payroll_branch', 'salary-slip-batch', 1, 1, 1),
('payroll_branch', 'lwp-deduction', 1, 1, 1),
('payroll_branch', 'attendance-summary', 1, 1, 1),
('payroll_branch', 'leave-balance-summary', 1, 0, 1),
('payroll_branch', 'employee-directory', 1, 0, 1),
('payroll_branch', 'headcount-trend', 1, 0, 1),
('payroll_branch', 'ctc-breakup', 1, 0, 1);

-- ============================================================================
-- HR ROLE PERMISSIONS
-- ============================================================================

-- HR (full HR reports)
INSERT INTO role_report_permissions (role_key, report_code, can_view, can_export, granted_by) VALUES
('hr', 'employee-directory', 1, 1, 1),
('hr', 'employee-master-data', 1, 1, 1),
('hr', 'headcount-trend', 1, 1, 1),
('hr', 'joining-report', 1, 1, 1),
('hr', 'attrition-report', 1, 1, 1),
('hr', 'exit-interview-summary', 1, 1, 1),
('hr', 'probation-status', 1, 1, 1),
('hr', 'confirmation-due', 1, 1, 1),
('hr', 'attendance-summary', 1, 1, 1),
('hr', 'attendance-day-detail', 1, 1, 1),
('hr', 'leave-balance-summary', 1, 1, 1),
('hr', 'leave-trend-monthly', 1, 1, 1),
('hr', 'leave-request-log', 1, 1, 1),
('hr', 'document-compliance', 1, 1, 1),
('hr', 'bgv-status', 1, 1, 1),
('hr', 'onboarding-tracker', 1, 1, 1),
('hr', 'employee-lifecycle-events', 1, 1, 1),
('hr', 'roster-vs-actual', 1, 1, 1),
('hr', 'late-arrival-report', 1, 1, 1),
('hr', 'overtime-report', 1, 1, 1);

-- Branch HR (same as HR but branch-scoped)
INSERT INTO role_report_permissions (role_key, report_code, can_view, can_export, granted_by)
SELECT 'branch_hr', report_code, can_view, can_export, granted_by
FROM role_report_permissions WHERE role_key = 'hr';

-- HR Branch (alias for branch_hr)
INSERT INTO role_report_permissions (role_key, report_code, can_view, can_export, granted_by)
SELECT 'hr_branch', report_code, can_view, can_export, granted_by
FROM role_report_permissions WHERE role_key = 'hr';

-- ============================================================================
-- CROSS-ROLE REPORTS (commonly needed by multiple roles)
-- ============================================================================

-- Manager role (team-scoped reports)
INSERT INTO role_report_permissions (role_key, report_code, can_view, can_export, granted_by) VALUES
('manager', 'employee-directory', 1, 0, 1),
('manager', 'attendance-summary', 1, 0, 1),
('manager', 'leave-balance-summary', 1, 0, 1),
('manager', 'break-session-detail', 1, 0, 1),
('manager', 'late-arrival-report', 1, 0, 1),
('manager', 'headcount-trend', 1, 0, 1);

-- Team Leader (alias for manager)
INSERT INTO role_report_permissions (role_key, report_code, can_view, can_export, granted_by)
SELECT 'team_leader', report_code, can_view, can_export, granted_by
FROM role_report_permissions WHERE role_key = 'manager';

INSERT INTO role_report_permissions (role_key, report_code, can_view, can_export, granted_by)
SELECT 'tl', report_code, can_view, can_export, granted_by
FROM role_report_permissions WHERE role_key = 'manager';

-- Process Manager (process-scoped, more reports than manager)
INSERT INTO role_report_permissions (role_key, report_code, can_view, can_export, granted_by) VALUES
('process_manager', 'employee-directory', 1, 1, 1),
('process_manager', 'attendance-summary', 1, 1, 1),
('process_manager', 'attendance-day-detail', 1, 1, 1),
('process_manager', 'leave-balance-summary', 1, 1, 1),
('process_manager', 'leave-trend-monthly', 1, 0, 1),
('process_manager', 'break-session-detail', 1, 1, 1),
('process_manager', 'break-kiosk-hourly', 1, 1, 1),
('process_manager', 'late-arrival-report', 1, 1, 1),
('process_manager', 'headcount-trend', 1, 1, 1),
('process_manager', 'roster-vs-actual', 1, 0, 1),
('process_manager', 'attrition-report', 1, 0, 1),
('process_manager', 'probation-status', 1, 0, 1);

-- Branch Head (branch-wide access)
INSERT INTO role_report_permissions (role_key, report_code, can_view, can_export, granted_by) VALUES
('branch_head', 'employee-directory', 1, 1, 1),
('branch_head', 'headcount-trend', 1, 1, 1),
('branch_head', 'attendance-summary', 1, 1, 1),
('branch_head', 'leave-balance-summary', 1, 1, 1),
('branch_head', 'attrition-report', 1, 1, 1),
('branch_head', 'payroll-cost-summary', 1, 0, 1),
('branch_head', 'roster-coverage', 1, 1, 1),
('branch_head', 'shrinkage-daily', 1, 1, 1),
('branch_head', 'break-utilization', 1, 1, 1),
('branch_head', 'late-arrival-report', 1, 1, 1),
('branch_head', 'overtime-report', 1, 1, 1);

-- Log the migration
SELECT CONCAT('Migration 1644 complete: ', COUNT(*), ' role_report_permissions created') AS status
FROM role_report_permissions WHERE active_status = 1;
