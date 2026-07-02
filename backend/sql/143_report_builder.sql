-- 143_report_builder.sql
-- Registers all 28 new reports in report_master.
-- Safe to re-run: uses INSERT IGNORE.

INSERT IGNORE INTO report_master
  (id, report_code, report_name, report_category, query_key, default_filters, export_formats, admin_only, active_status)
VALUES
-- ── Payroll (6) ─────────────────────────────────────────────────────────────
(UUID(), 'PAYROLL_REGISTER',         'Monthly Payroll Register',              'payroll',    'payroll_register',         NULL, '["csv","xlsx"]', 1, 1),
(UUID(), 'PAYROLL_COMPONENT_DETAIL', 'Payroll Component Breakdown',           'payroll',    'payroll_component_detail',  NULL, '["csv","xlsx"]', 1, 1),
(UUID(), 'PAYROLL_STATUTORY',        'PF / ESIC / PT / TDS Summary',          'payroll',    'payroll_statutory',         NULL, '["csv","xlsx"]', 1, 1),
(UUID(), 'PAYROLL_BANK_STATEMENT',   'Bank Disbursement Statement',           'payroll',    'payroll_bank_statement',    NULL, '["csv","xlsx"]', 1, 1),
(UUID(), 'PAYROLL_FULL_FINAL',       'Full & Final Settlement Report',        'payroll',    'payroll_full_final',        NULL, '["csv","xlsx"]', 1, 1),
(UUID(), 'PAYROLL_YTD',              'Year-to-Date Earnings & Deductions',    'payroll',    'payroll_ytd',               NULL, '["csv","xlsx"]', 1, 1),

-- ── Employee (5) ─────────────────────────────────────────────────────────────
(UUID(), 'EMP_MASTER',               'Employee Master Report',                'employee',   'emp_master',               NULL, '["csv","xlsx"]', 0, 1),
(UUID(), 'EMP_STATUTORY',            'Employee Statutory Data (PAN/UAN/ESIC)','employee',   'emp_statutory',             NULL, '["csv","xlsx"]', 1, 1),
(UUID(), 'EMP_BANK_DETAILS',         'Employee Bank Details',                 'employee',   'emp_bank_details',          NULL, '["csv","xlsx"]', 1, 1),
(UUID(), 'EMP_JOINING_EXIT',         'Joiners & Leavers Report',              'employee',   'emp_joining_exit',          NULL, '["csv","xlsx"]', 0, 1),
(UUID(), 'EMP_DOCUMENTS',            'Document Submission Status',            'employee',   'emp_documents',             NULL, '["csv"]',        0, 1),

-- ── Attendance & Biometric (5) ───────────────────────────────────────────────
(UUID(), 'ATT_MONTHLY',              'Monthly Attendance Register',           'attendance', 'att_monthly',               NULL, '["csv","xlsx"]', 0, 1),
(UUID(), 'ATT_LATE_MARK',            'Late Mark Summary',                     'attendance', 'att_late_mark',             NULL, '["csv","xlsx"]', 0, 1),
(UUID(), 'ATT_BIOMETRIC',            'Biometric Punch Log',                   'attendance', 'att_biometric',             NULL, '["csv","xlsx"]', 0, 1),
(UUID(), 'ATT_REGULARIZATION',       'Attendance Regularization Report',      'attendance', 'att_regularization',        NULL, '["csv"]',        0, 1),
(UUID(), 'ATT_RECONCILIATION',       'Unreconciled Attendance Records',       'attendance', 'att_reconciliation',        NULL, '["csv"]',        1, 1),

-- ── APR / Dialer (3) ─────────────────────────────────────────────────────────
(UUID(), 'APR_DAILY',                'Daily APR Report',                      'kpi',        'apr_daily',                 NULL, '["csv","xlsx"]', 0, 1),
(UUID(), 'APR_MONTHLY',              'Monthly APR Summary',                   'kpi',        'apr_monthly',               NULL, '["csv","xlsx"]', 0, 1),
(UUID(), 'APR_CAMPAIGN',             'Campaign-wise Performance',             'kpi',        'apr_campaign',              NULL, '["csv","xlsx"]', 0, 1),

-- ── Leave (3) ────────────────────────────────────────────────────────────────
(UUID(), 'LEAVE_BALANCE',            'Leave Balance by Type',                 'attendance', 'leave_balance',             NULL, '["csv","xlsx"]', 0, 1),
(UUID(), 'LEAVE_TRANSACTIONS',       'Leave Applications & Approvals',        'attendance', 'leave_transactions',        NULL, '["csv","xlsx"]', 0, 1),
(UUID(), 'LEAVE_LWP',                'LWP (Loss of Pay) Report',              'attendance', 'leave_lwp',                 NULL, '["csv","xlsx"]', 1, 1),

-- ── KPI (2) ──────────────────────────────────────────────────────────────────
(UUID(), 'KPI_SCORES',               'Employee KPI Scores by Period',         'kpi',        'kpi_scores',                NULL, '["csv","xlsx"]', 0, 1),
(UUID(), 'KPI_SUMMARY',              'Process / Branch KPI Rollup',           'kpi',        'kpi_summary',               NULL, '["csv","xlsx"]', 0, 1),

-- ── Attrition & Lifecycle (2) ────────────────────────────────────────────────
(UUID(), 'ATTRITION_MONTHLY',        'Monthly Attrition Report',              'employee',   'attrition_monthly',         NULL, '["csv","xlsx"]', 0, 1),
(UUID(), 'EMP_LIFECYCLE',            'Promotions, Transfers & Increments',    'employee',   'emp_lifecycle',             NULL, '["csv","xlsx"]', 0, 1),

-- ── Compliance / Statutory (2) ───────────────────────────────────────────────
(UUID(), 'PF_CHALLAN',               'PF Contribution Challan Data',          'payroll',    'pf_challan',                NULL, '["csv","xlsx"]', 1, 1),
(UUID(), 'ESIC_CHALLAN',             'ESIC Contribution Summary',             'payroll',    'esic_challan',              NULL, '["csv","xlsx"]', 1, 1);

-- ── Employee Detail Reports (5 new) ──────────────────────────────────────────
INSERT IGNORE INTO report_master
  (id, report_code, report_name, report_category, query_key, default_filters, export_formats, admin_only, active_status)
VALUES
(UUID(), 'EMP_EMERGENCY_CONTACT', 'Emergency Contact Report',         'employee', 'emp_emergency_contact', NULL, '["csv","xlsx"]', 0, 1),
(UUID(), 'EMP_NOMINEE',           'Nominee Report',                   'employee', 'emp_nominee',           NULL, '["csv","xlsx"]', 0, 1),
(UUID(), 'EMP_PROBATION',         'Probation & Confirmation Report',  'employee', 'emp_probation',         NULL, '["csv","xlsx"]', 0, 1),
(UUID(), 'EMP_JOB_HISTORY',       'Job History / Movement Report',    'employee', 'emp_job_history',       NULL, '["csv","xlsx"]', 0, 1),
(UUID(), 'EMP_SALARY_HISTORY',    'Salary Revision History',          'employee', 'emp_salary_history',    NULL, '["csv","xlsx"]', 1, 1);
