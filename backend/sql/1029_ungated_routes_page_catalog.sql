-- Migration: 1029_ungated_routes_page_catalog.sql
-- Purpose:  Fix production-broken page codes (JOB_REQUISITION, ATS_ONBOARDING_REQUESTS
--           were inserted into wrong tables by earlier migrations), and add page_catalog
--           rows for all currently un-gated frontend routes so they are visible in the
--           Access Control UI and can be toggled per-role / per-user.
-- Safety:   INSERT IGNORE / ON DUPLICATE KEY UPDATE only. No DROP, no DELETE.
--           NOT EXECUTED AUTOMATICALLY — run manually on staging first.
-- Created:  2026-07-31

-- ─── Fix production-broken page codes ─────────────────────────────────────────
-- Migration 523 inserted JOB_REQUISITION into `page_master` (wrong table).
-- Migration 1005 inserted ATS_ONBOARDING_REQUESTS into `workforce_page_catalog` (wrong table).
-- The WorkforcePageGate queries `page_catalog`, so these codes return "no access" for everyone.

INSERT IGNORE INTO page_catalog (id, page_code, page_name, page_path, module, active_status) VALUES
  (UUID(), 'JOB_REQUISITION',         'Job Requisitions',              '/recruitment/job-requisition',  'ATS',       1),
  (UUID(), 'ATS_ONBOARDING_REQUESTS', 'ATS Onboarding Requests',       '/ats/onboarding-requests',      'ATS',       1);

-- ─── Payroll sub-pages ────────────────────────────────────────────────────────
INSERT IGNORE INTO page_catalog (id, page_code, page_name, page_path, module, active_status) VALUES
  (UUID(), 'PAYROLL_PACKAGE_ADMIN',       'Salary Package Admin',          '/payroll/package-admin',                'Payroll', 1),
  (UUID(), 'PAYROLL_OVERTIME',            'Overtime Management',           '/payroll/overtime',                     'Payroll', 1),
  (UUID(), 'PAYROLL_DISBURSAL',           'Disbursal Management',          '/payroll/disbursal',                    'Payroll', 1),
  (UUID(), 'PAYROLL_CONFIG_FLAGS',        'Payroll Config Flags',          '/payroll/config-flags',                 'Payroll', 1),
  (UUID(), 'PAYROLL_RECALC_QUEUE',        'Recalculation Queue',           '/payroll/recalculation-queue',          'Payroll', 1),
  (UUID(), 'PAYROLL_ATTENDANCE_TOWER',    'Attendance Control Tower',      '/payroll/attendance-control-tower',     'Payroll', 1),
  (UUID(), 'PAYROLL_RUNNING_BREAKDOWN',   'Running Payroll Breakdown',     '/payroll/running-breakdown',            'Payroll', 1),
  (UUID(), 'PAYROLL_HOLIDAY_MASTER',      'Holiday Master',                '/payroll/holiday-master',               'Payroll', 1),
  (UUID(), 'PAYROLL_HOLIDAY_WORK',        'Holiday Work',                  '/payroll/holiday-work',                 'Payroll', 1),
  (UUID(), 'PAYROLL_VALIDATION',          'Payroll Validation',            '/payroll/validation',                   'Payroll', 1),
  (UUID(), 'PAYROLL_NOC',                 'NOC Management',                '/payroll/noc',                          'Payroll', 1),
  (UUID(), 'PAYROLL_BRANCH_READINESS',    'Branch Payroll Readiness',      '/payroll/branch-readiness',             'Payroll', 1),
  (UUID(), 'PAYROLL_PROCESS_READINESS',   'Process Payroll Readiness',     '/payroll/process-readiness',            'Payroll', 1),
  (UUID(), 'PAYROLL_CALENDAR',            'Payroll Calendar',              '/payroll/calendar',                     'Payroll', 1),
  (UUID(), 'PAYROLL_STATUTORY_FILING',    'Statutory Filing Tracker',      '/payroll/statutory-filing',             'Payroll', 1),
  (UUID(), 'PAYROLL_AUDIT_TRAIL',         'Payroll Audit Trail',           '/payroll/audit-trail',                  'Payroll', 1),
  (UUID(), 'PAYROLL_BULK_OUTPUTS',        'Bulk Payroll Outputs',          '/payroll/bulk-outputs',                 'Payroll', 1),
  (UUID(), 'PAYROLL_LOANS',              'Loan Management',                '/payroll/loans',                        'Payroll', 1),
  (UUID(), 'PAYROLL_SIGN_OFF',            'Payroll Sign-Off',              '/payroll/sign-off',                     'Payroll', 1),
  (UUID(), 'PAYROLL_SALARY_CERTIFICATES','Salary Certificates',            '/payroll/salary-certificates',          'Payroll', 1),
  (UUID(), 'PAYROLL_REIMBURSEMENTS',      'Reimbursement Management',      '/payroll/reimbursements',               'Payroll', 1),
  (UUID(), 'PAYROLL_HO_QUEUES',           'Payroll HO Queues',             '/payroll/ho-queues',                    'Payroll', 1),
  (UUID(), 'PAYROLL_EPF_COMPLIANCE',      'EPF Compliance',                '/payroll/epf-compliance',               'Payroll', 1),
  (UUID(), 'PAYROLL_PF_MANAGEMENT',       'PF Management',                 '/payroll/pf-management',                'Payroll', 1);

-- ─── Finance sub-pages ────────────────────────────────────────────────────────
INSERT IGNORE INTO page_catalog (id, page_code, page_name, page_path, module, active_status) VALUES
  (UUID(), 'FINANCE_VENDOR_PAYMENTS',     'Vendor Payment Tracking',       '/finance/vendor-payment-tracking',      'Finance', 1),
  (UUID(), 'FINANCE_GRN',                 'GRN Management',                '/finance/grn',                          'Finance', 1),
  (UUID(), 'FINANCE_BRANCH_BUDGET',       'Branch Budget',                 '/finance/branch-budget',                'Finance', 1),
  (UUID(), 'FINANCE_BUDGET_CONSOLIDATION','Budget Consolidation',          '/finance/budget-consolidation',         'Finance', 1),
  (UUID(), 'FINANCE_PROCESS_PNL',         'Process P&L',                   '/finance/process-pnl',                  'Finance', 1),
  (UUID(), 'FINANCE_PNL_CONFIG',          'P&L Configuration',             '/finance/process-pnl/configuration',    'Finance', 1),
  (UUID(), 'FINANCE_PNL_LOBS',            'P&L LOBs',                      '/finance/process-pnl/lobs',             'Finance', 1),
  (UUID(), 'FINANCE_PNL_PERIOD_CLOSE',    'P&L Period Close',              '/finance/process-pnl/period-close',     'Finance', 1);

-- ─── Workforce / WFM sub-pages ────────────────────────────────────────────────
INSERT IGNORE INTO page_catalog (id, page_code, page_name, page_path, module, active_status) VALUES
  (UUID(), 'ATTENDANCE_BILLING_CONFIG',   'Attendance Billing Config',     '/attendance/billing-config',            'Attendance', 1),
  (UUID(), 'ATTENDANCE_MISMATCH_QUEUE',   'Attendance Mismatch Queue',     '/wfm/mismatch-queue',                   'Attendance', 1),
  (UUID(), 'ATTENDANCE_RULES_MASTER',     'Attendance Rules Master',       '/attendance-rules-master',              'Attendance', 1),
  (UUID(), 'HR_ATTENDANCE_LOOKUP',        'HR Attendance Lookup',          '/hr/attendance-lookup',                 'Attendance', 1),
  (UUID(), 'MATERNITY_LEAVE',             'Maternity Leave Management',    '/maternity-leave',                      'Leave',      1),
  (UUID(), 'WFM_PLANNING_RULES',          'WFM Planning Rules',            '/wfm/planning-rules',                   'WFM',        1),
  (UUID(), 'WFM_SLOT_REQUIREMENTS',       'Slot Requirement Builder',      '/wfm/slot-requirements',                'WFM',        1),
  (UUID(), 'WFM_WEEKOFF_DAY_RULES',       'Week-Off Day Rules',            '/wfm/weekoff-day-rules',                'WFM',        1),
  (UUID(), 'WFM_WEEKOFF_FAIRNESS',        'Week-Off Fairness',             '/wfm/weekoff-fairness',                 'WFM',        1),
  (UUID(), 'WFM_BRANCH_SPOC_CONFIG',      'Branch WFM SPOC Config',        '/wfm/branch-spoc-config',               'WFM',        1),
  (UUID(), 'WFM_BREAK_DESK_DEVICES',      'Break Desk Devices',            '/wfm/break-desk-devices',               'WFM',        1),
  (UUID(), 'BUSINESS_COMMAND_CENTER',     'Business Command Center',       '/business-command-center',              'WFM',        1),
  (UUID(), 'BUSINESS_ACTION_QUEUE',       'Business Action Queue',         '/business-actions',                     'WFM',        1);

-- ─── Platform / Admin sub-pages ──────────────────────────────────────────────
INSERT IGNORE INTO page_catalog (id, page_code, page_name, page_path, module, active_status) VALUES
  (UUID(), 'MIGRATION_CONSOLE',           'Migration Console',             '/migration-console',                    'Admin',    1),
  (UUID(), 'AUDIT_LOG',                   'Audit Log',                     '/audit-log',                            'Admin',    1),
  (UUID(), 'SECURITY_CENTER',             'Security Center',               '/security-center',                      'Admin',    1),
  (UUID(), 'SUPER_ADMIN_PAGE_ACCESS',     'Super Admin Page Access',       '/super-admin/page-access',              'Admin',    1),
  (UUID(), 'SUPER_ADMIN_MODULE_ACCESS',   'Super Admin Module Access',     '/super-admin/module-access',            'Admin',    1),
  (UUID(), 'SUPER_ADMIN_POLICY_ENGINE',   'Policy Engine',                 '/super-admin/policy-engine',            'Admin',    1),
  (UUID(), 'BULK_UPLOAD',                 'Bulk Upload',                   '/bulk-upload',                          'Admin',    1),
  (UUID(), 'CONTROL_TOWER',              'Control Tower',                  '/control-tower',                        'Admin',    1),
  (UUID(), 'COMM_TEMPLATES',             'Communication Templates',        '/communication/templates',              'Settings', 1),
  (UUID(), 'COMM_DISPATCH',              'Communication Dispatch',         '/communication/dispatch',               'Settings', 1),
  (UUID(), 'COMM_HISTORY',               'Communication History',          '/communication/history',                'Settings', 1),
  (UUID(), 'COMM_CONFIG',                'Communication Config',           '/settings/communication-config',        'Settings', 1),
  (UUID(), 'CALL_CENTRE_CONFIG',         'Call Centre Config',             '/settings/call-centre-config',          'Settings', 1);

-- ─── Quality / Operations / Performance sub-pages ────────────────────────────
INSERT IGNORE INTO page_catalog (id, page_code, page_name, page_path, module, active_status) VALUES
  (UUID(), 'QUALITY_DASHBOARD',           'Quality Dashboard',             '/quality/dashboard',                    'Quality', 1),
  (UUID(), 'QUALITY_EXECUTIVE',           'Executive Quality Dashboard',   '/quality/executive',                    'Quality', 1),
  (UUID(), 'QUALITY_TEAM',                'Team Quality Dashboard',        '/quality/team',                         'Quality', 1),
  (UUID(), 'CALL_MASTER',                 'Call Master Dashboard',         '/call-master',                          'Quality', 1),
  (UUID(), 'CALL_MASTER_INBOUND',         'Call Master Inbound',           '/call-master/inbound',                  'Quality', 1),
  (UUID(), 'SALES_BRAND_ANALYTICS',       'Sales Brand Analytics',         '/sales/brand-analytics',                'Quality', 1),
  (UUID(), 'AGENT_PERFORMANCE',           'Agent Performance Dashboard',   '/agent-performance',                    'Quality', 1),
  (UUID(), 'PERFORMANCE_HUB',             'Performance Hub',               '/performance-hub',                      'Quality', 1);

-- ─── Backfill super_admin with full access on all newly added pages ───────────
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

-- ─── Verification ─────────────────────────────────────────────────────────────
-- SELECT module, COUNT(*) AS pages FROM page_catalog WHERE active_status = 1 GROUP BY module ORDER BY module;
-- SELECT page_code FROM page_catalog WHERE page_code IN ('JOB_REQUISITION','ATS_ONBOARDING_REQUESTS');
