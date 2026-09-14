-- Migration 538: Backfill route-mapped page codes that were mounted in the app
-- but never fully registered in page_catalog / role_page_access.
-- This protects deployment after ProtectedRoute page-code enforcement.
-- Safe to rerun.

INSERT IGNORE INTO page_catalog
  (id, page_code, page_name, page_path, module, description, active_status, created_at)
VALUES
  (UUID(), 'ATTENDANCE_DISPUTES',              'Attendance Disputes',              '/attendance/disputes',              'WFM',        'Attendance dispute review workspace',                                 1, NOW()),
  (UUID(), 'ATTENDANCE_LOOKUP',                'Attendance Lookup',                '/hr/attendance-lookup',             'WFM',        'Cross-employee attendance lookup and review',                         1, NOW()),
  (UUID(), 'BULK_UPLOAD',                      'Bulk Upload',                      '/bulk-upload',                      'Admin',      'Bulk data import and upload hub',                                     1, NOW()),
  (UUID(), 'IT_MANAGER_DASHBOARD',             'IT Manager Dashboard',             '/it/dashboard',                     'Dashboards', 'IT provisioning, account, and asset dashboard',                       1, NOW()),
  (UUID(), 'PAYROLL_ATTENDANCE_CONTROL_TOWER', 'Payroll Attendance Control Tower', '/payroll/attendance-control-tower', 'Payroll',    'COSEC, APR, and payroll attendance conflict control tower',           1, NOW()),
  (UUID(), 'PAYROLL_AUDIT_TRAIL',              'Payroll Audit Trail',              '/payroll/audit-trail',              'Payroll',    'Payroll change and run audit trail',                                  1, NOW()),
  (UUID(), 'PAYROLL_BRANCH_READINESS',         'Payroll Branch Readiness',         '/payroll/branch-readiness',         'Payroll',    'Branch-level payroll readiness workspace',                            1, NOW()),
  (UUID(), 'PAYROLL_BULK_OUTPUTS',             'Payroll Bulk Outputs',             '/payroll/bulk-outputs',             'Payroll',    'Bulk payroll export and output center',                               1, NOW()),
  (UUID(), 'PAYROLL_CALENDAR',                 'Payroll Calendar',                 '/payroll/calendar',                 'Payroll',    'Payroll cycle calendar and cut-offs',                                 1, NOW()),
  (UUID(), 'PAYROLL_CHEQUE_VALIDATION',        'Payroll Cheque Validation',        '/payroll/cheque-validation',        'Payroll',    'Legacy cheque validation route redirected to HO queues',              1, NOW()),
  (UUID(), 'PAYROLL_CONFIG_FLAGS',             'Payroll Config Flags',             '/payroll/config-flags',             'Payroll',    'Payroll processing feature flags and controls',                       1, NOW()),
  (UUID(), 'PAYROLL_COST_SUMMARY',             'Payroll Cost Summary',             '/payroll/cost-summary',             'Payroll',    'Payroll cost summary and finance overview',                           1, NOW()),
  (UUID(), 'PAYROLL_HOLIDAY_MASTER',           'Payroll Holiday Master',           '/payroll/holiday-master',           'Payroll',    'Holiday master and payroll treatment settings',                       1, NOW()),
  (UUID(), 'PAYROLL_HOLIDAY_WORK_APPROVALS',   'Payroll Holiday Work Approvals',   '/payroll/holiday-work-approvals',   'Payroll',    'Legacy holiday work approval route redirected to unified workspace',  1, NOW()),
  (UUID(), 'PAYROLL_HOLIDAY_WORK_REQUESTS',    'Payroll Holiday Work Requests',    '/payroll/holiday-work-requests',    'Payroll',    'Legacy holiday work request route redirected to unified workspace',   1, NOW()),
  (UUID(), 'PAYROLL_HO_QUEUES',                'Payroll HO Queues',                '/payroll/ho-queues',                'Payroll',    'Head office payroll operational queues',                              1, NOW()),
  (UUID(), 'PAYROLL_NOC',                      'Payroll NOC',                      '/payroll/noc',                      'Payroll',    'No-objection and payroll clearance workflow',                         1, NOW()),
  (UUID(), 'PAYROLL_OVERTIME',                 'Payroll Overtime',                 '/payroll/overtime',                 'Payroll',    'Overtime review and payout configuration',                            1, NOW()),
  (UUID(), 'PAYROLL_RECALCULATION_QUEUE',      'Payroll Recalculation Queue',      '/payroll/recalculation-queue',      'Payroll',    'Queued payroll recalculations and reruns',                            1, NOW()),
  (UUID(), 'PAYROLL_REIMBURSEMENTS',           'Payroll Reimbursements',           '/payroll/reimbursements',           'Payroll',    'Employee reimbursement processing and status',                        1, NOW()),
  (UUID(), 'PAYROLL_RUNNING_BREAKDOWN',        'Payroll Running Breakdown',        '/payroll/running-breakdown',        'Payroll',    'Live payroll month running amount breakdown',                         1, NOW()),
  (UUID(), 'PAYROLL_SIGN_OFF',                 'Payroll Sign-off',                 '/payroll/sign-off',                 'Payroll',    'Payroll run sign-off and approval',                                   1, NOW()),
  (UUID(), 'PAYROLL_STATUTORY_FILING',         'Payroll Statutory Filing',         '/payroll/statutory-filing',         'Payroll',    'Statutory filing tracker and compliance workspace',                   1, NOW()),
  (UUID(), 'PAYROLL_VALIDATION',               'Payroll Validation',               '/payroll/validation',               'Payroll',    'Payroll validation and approval screen',                              1, NOW()),
  (UUID(), 'PAYROLL_VARIANCE',                 'Payroll Variance',                 '/payroll/variance',                 'Payroll',    'Payroll variance analysis report',                                    1, NOW()),
  (UUID(), 'WFM_ATTENDANCE_DASHBOARD',         'WFM Attendance Dashboard',         '/wfm-attendance',                   'Dashboards', 'WFM attendance dashboard and drilldown workspace',                    1, NOW()),
  (UUID(), 'WFM_PLANNING_RULES',               'WFM Planning Rules',               '/wfm/planning-rules',               'WFM',        'WFM shift planning rules and controls',                               1, NOW()),
  (UUID(), 'WFM_SLOT_REQUIREMENTS',            'WFM Slot Requirements',            '/wfm/slot-requirements',            'WFM',        'WFM slot and coverage requirement builder',                           1, NOW()),
  (UUID(), 'WFM_WEEKOFF_DAY_RULES',            'WFM Weekoff Day Rules',            '/wfm/weekoff-day-rules',            'WFM',        'WFM weekoff day rule configuration',                                  1, NOW());

INSERT IGNORE INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status, created_at)
VALUES
  (UUID(), 'super_admin',     'ATTENDANCE_DISPUTES',              1,1,1,1,1, 1, NOW()),
  (UUID(), 'admin',           'ATTENDANCE_DISPUTES',              1,1,1,0,1, 1, NOW()),
  (UUID(), 'hr',              'ATTENDANCE_DISPUTES',              1,1,1,0,1, 1, NOW()),
  (UUID(), 'wfm',             'ATTENDANCE_DISPUTES',              1,1,1,0,1, 1, NOW()),
  (UUID(), 'manager',         'ATTENDANCE_DISPUTES',              1,0,0,0,1, 1, NOW()),

  (UUID(), 'super_admin',     'ATTENDANCE_LOOKUP',                1,1,1,1,1, 1, NOW()),
  (UUID(), 'admin',           'ATTENDANCE_LOOKUP',                1,1,1,0,1, 1, NOW()),
  (UUID(), 'hr',              'ATTENDANCE_LOOKUP',                1,1,1,0,1, 1, NOW()),
  (UUID(), 'wfm',             'ATTENDANCE_LOOKUP',                1,1,1,0,1, 1, NOW()),
  (UUID(), 'payroll_head',    'ATTENDANCE_LOOKUP',                1,1,0,0,1, 1, NOW()),
  (UUID(), 'payroll_admin',   'ATTENDANCE_LOOKUP',                1,1,0,0,1, 1, NOW()),

  (UUID(), 'super_admin',     'BULK_UPLOAD',                      1,1,1,1,1, 1, NOW()),
  (UUID(), 'admin',           'BULK_UPLOAD',                      1,1,1,1,1, 1, NOW()),
  (UUID(), 'hr',              'BULK_UPLOAD',                      1,1,1,0,1, 1, NOW()),
  (UUID(), 'wfm',             'BULK_UPLOAD',                      1,1,1,0,1, 1, NOW()),
  (UUID(), 'payroll',         'BULK_UPLOAD',                      1,1,1,0,1, 1, NOW()),
  (UUID(), 'payroll_hr',      'BULK_UPLOAD',                      1,1,1,0,1, 1, NOW()),

  (UUID(), 'super_admin',     'IT_MANAGER_DASHBOARD',             1,1,1,1,1, 1, NOW()),
  (UUID(), 'it',              'IT_MANAGER_DASHBOARD',             1,1,1,0,1, 1, NOW()),
  (UUID(), 'it_admin',        'IT_MANAGER_DASHBOARD',             1,1,1,0,1, 1, NOW()),
  (UUID(), 'branch_it',       'IT_MANAGER_DASHBOARD',             1,1,1,0,1, 1, NOW()),
  (UUID(), 'ho_it',           'IT_MANAGER_DASHBOARD',             1,1,1,0,1, 1, NOW()),

  (UUID(), 'super_admin',     'PAYROLL_ATTENDANCE_CONTROL_TOWER', 1,1,1,1,1, 1, NOW()),
  (UUID(), 'admin',           'PAYROLL_ATTENDANCE_CONTROL_TOWER', 1,1,1,0,1, 1, NOW()),
  (UUID(), 'payroll_head',    'PAYROLL_ATTENDANCE_CONTROL_TOWER', 1,1,1,0,1, 1, NOW()),
  (UUID(), 'payroll_branch',  'PAYROLL_ATTENDANCE_CONTROL_TOWER', 1,1,1,0,1, 1, NOW()),
  (UUID(), 'payroll',         'PAYROLL_ATTENDANCE_CONTROL_TOWER', 1,1,1,0,1, 1, NOW()),
  (UUID(), 'hr',              'PAYROLL_ATTENDANCE_CONTROL_TOWER', 1,1,0,0,1, 1, NOW()),
  (UUID(), 'wfm',             'PAYROLL_ATTENDANCE_CONTROL_TOWER', 1,1,0,0,1, 1, NOW()),
  (UUID(), 'branch_head',     'PAYROLL_ATTENDANCE_CONTROL_TOWER', 1,0,0,0,1, 1, NOW()),

  (UUID(), 'super_admin',     'PAYROLL_AUDIT_TRAIL',              1,1,1,1,1, 1, NOW()),
  (UUID(), 'payroll_head',    'PAYROLL_AUDIT_TRAIL',              1,1,0,0,1, 1, NOW()),
  (UUID(), 'finance',         'PAYROLL_AUDIT_TRAIL',              1,1,0,0,1, 1, NOW()),
  (UUID(), 'admin',           'PAYROLL_AUDIT_TRAIL',              1,1,1,0,1, 1, NOW()),

  (UUID(), 'super_admin',     'PAYROLL_BRANCH_READINESS',         1,1,1,1,1, 1, NOW()),
  (UUID(), 'payroll_head',    'PAYROLL_BRANCH_READINESS',         1,1,1,0,1, 1, NOW()),
  (UUID(), 'branch_head',     'PAYROLL_BRANCH_READINESS',         1,0,0,0,1, 1, NOW()),
  (UUID(), 'payroll_branch',  'PAYROLL_BRANCH_READINESS',         1,1,1,0,1, 1, NOW()),
  (UUID(), 'admin',           'PAYROLL_BRANCH_READINESS',         1,1,1,0,1, 1, NOW()),
  (UUID(), 'hr',              'PAYROLL_BRANCH_READINESS',         1,1,0,0,1, 1, NOW()),
  (UUID(), 'finance',         'PAYROLL_BRANCH_READINESS',         1,1,0,0,1, 1, NOW()),
  (UUID(), 'payroll',         'PAYROLL_BRANCH_READINESS',         1,1,0,0,1, 1, NOW()),

  (UUID(), 'super_admin',     'PAYROLL_BULK_OUTPUTS',             1,1,1,1,1, 1, NOW()),
  (UUID(), 'payroll_head',    'PAYROLL_BULK_OUTPUTS',             1,1,1,0,1, 1, NOW()),
  (UUID(), 'admin',           'PAYROLL_BULK_OUTPUTS',             1,1,1,0,1, 1, NOW()),

  (UUID(), 'super_admin',     'PAYROLL_CALENDAR',                 1,1,1,1,1, 1, NOW()),
  (UUID(), 'payroll_head',    'PAYROLL_CALENDAR',                 1,1,1,0,1, 1, NOW()),
  (UUID(), 'payroll_branch',  'PAYROLL_CALENDAR',                 1,1,1,0,1, 1, NOW()),

  (UUID(), 'super_admin',     'PAYROLL_CHEQUE_VALIDATION',        1,1,1,1,1, 1, NOW()),
  (UUID(), 'payroll_head',    'PAYROLL_CHEQUE_VALIDATION',        1,1,1,0,1, 1, NOW()),
  (UUID(), 'payroll',         'PAYROLL_CHEQUE_VALIDATION',        1,1,0,0,1, 1, NOW()),
  (UUID(), 'finance',         'PAYROLL_CHEQUE_VALIDATION',        1,1,0,0,1, 1, NOW()),
  (UUID(), 'hr',              'PAYROLL_CHEQUE_VALIDATION',        1,0,0,0,1, 1, NOW()),
  (UUID(), 'admin',           'PAYROLL_CHEQUE_VALIDATION',        1,1,1,0,1, 1, NOW()),

  (UUID(), 'super_admin',     'PAYROLL_CONFIG_FLAGS',             1,1,1,1,1, 1, NOW()),
  (UUID(), 'admin',           'PAYROLL_CONFIG_FLAGS',             1,1,1,0,1, 1, NOW()),
  (UUID(), 'payroll_head',    'PAYROLL_CONFIG_FLAGS',             1,1,1,0,1, 1, NOW()),
  (UUID(), 'payroll_branch',  'PAYROLL_CONFIG_FLAGS',             1,1,1,0,1, 1, NOW()),

  (UUID(), 'super_admin',     'PAYROLL_COST_SUMMARY',             1,1,1,1,1, 1, NOW()),
  (UUID(), 'payroll_head',    'PAYROLL_COST_SUMMARY',             1,1,0,0,1, 1, NOW()),
  (UUID(), 'finance',         'PAYROLL_COST_SUMMARY',             1,1,0,0,1, 1, NOW()),

  (UUID(), 'super_admin',     'PAYROLL_HOLIDAY_MASTER',           1,1,1,1,1, 1, NOW()),
  (UUID(), 'admin',           'PAYROLL_HOLIDAY_MASTER',           1,1,1,0,1, 1, NOW()),
  (UUID(), 'payroll_head',    'PAYROLL_HOLIDAY_MASTER',           1,1,1,0,1, 1, NOW()),
  (UUID(), 'payroll_branch',  'PAYROLL_HOLIDAY_MASTER',           1,1,1,0,1, 1, NOW()),

  (UUID(), 'super_admin',     'PAYROLL_HOLIDAY_WORK_APPROVALS',   1,1,1,1,1, 1, NOW()),
  (UUID(), 'admin',           'PAYROLL_HOLIDAY_WORK_APPROVALS',   1,1,1,0,1, 1, NOW()),
  (UUID(), 'wfm',             'PAYROLL_HOLIDAY_WORK_APPROVALS',   1,1,0,0,1, 1, NOW()),
  (UUID(), 'payroll_head',    'PAYROLL_HOLIDAY_WORK_APPROVALS',   1,1,1,0,1, 1, NOW()),
  (UUID(), 'payroll_branch',  'PAYROLL_HOLIDAY_WORK_APPROVALS',   1,1,1,0,1, 1, NOW()),

  (UUID(), 'super_admin',     'PAYROLL_HOLIDAY_WORK_REQUESTS',    1,1,1,1,1, 1, NOW()),
  (UUID(), 'admin',           'PAYROLL_HOLIDAY_WORK_REQUESTS',    1,1,1,0,1, 1, NOW()),
  (UUID(), 'wfm',             'PAYROLL_HOLIDAY_WORK_REQUESTS',    1,1,0,0,1, 1, NOW()),
  (UUID(), 'payroll_head',    'PAYROLL_HOLIDAY_WORK_REQUESTS',    1,1,1,0,1, 1, NOW()),
  (UUID(), 'payroll_branch',  'PAYROLL_HOLIDAY_WORK_REQUESTS',    1,1,1,0,1, 1, NOW()),

  (UUID(), 'super_admin',     'PAYROLL_HO_QUEUES',                1,1,1,1,1, 1, NOW()),
  (UUID(), 'payroll_head',    'PAYROLL_HO_QUEUES',                1,1,1,0,1, 1, NOW()),
  (UUID(), 'payroll',         'PAYROLL_HO_QUEUES',                1,1,0,0,1, 1, NOW()),
  (UUID(), 'finance',         'PAYROLL_HO_QUEUES',                1,1,0,0,1, 1, NOW()),
  (UUID(), 'hr',              'PAYROLL_HO_QUEUES',                1,0,0,0,1, 1, NOW()),
  (UUID(), 'admin',           'PAYROLL_HO_QUEUES',                1,1,1,0,1, 1, NOW()),

  (UUID(), 'super_admin',     'PAYROLL_NOC',                      1,1,1,1,1, 1, NOW()),
  (UUID(), 'payroll_head',    'PAYROLL_NOC',                      1,1,1,0,1, 1, NOW()),
  (UUID(), 'payroll_branch',  'PAYROLL_NOC',                      1,1,1,0,1, 1, NOW()),
  (UUID(), 'payroll',         'PAYROLL_NOC',                      1,1,0,0,1, 1, NOW()),
  (UUID(), 'admin',           'PAYROLL_NOC',                      1,1,1,0,1, 1, NOW()),

  (UUID(), 'super_admin',     'PAYROLL_OVERTIME',                 1,1,1,1,1, 1, NOW()),
  (UUID(), 'admin',           'PAYROLL_OVERTIME',                 1,1,1,0,1, 1, NOW()),
  (UUID(), 'wfm',             'PAYROLL_OVERTIME',                 1,1,0,0,1, 1, NOW()),
  (UUID(), 'payroll',         'PAYROLL_OVERTIME',                 1,1,0,0,1, 1, NOW()),
  (UUID(), 'payroll_head',    'PAYROLL_OVERTIME',                 1,1,1,0,1, 1, NOW()),

  (UUID(), 'super_admin',     'PAYROLL_RECALCULATION_QUEUE',      1,1,1,1,1, 1, NOW()),
  (UUID(), 'admin',           'PAYROLL_RECALCULATION_QUEUE',      1,1,1,0,1, 1, NOW()),
  (UUID(), 'payroll_head',    'PAYROLL_RECALCULATION_QUEUE',      1,1,1,0,1, 1, NOW()),
  (UUID(), 'payroll_branch',  'PAYROLL_RECALCULATION_QUEUE',      1,1,1,0,1, 1, NOW()),

  (UUID(), 'super_admin',     'PAYROLL_REIMBURSEMENTS',           1,1,1,1,1, 1, NOW()),
  (UUID(), 'payroll_head',    'PAYROLL_REIMBURSEMENTS',           1,1,1,0,1, 1, NOW()),
  (UUID(), 'finance',         'PAYROLL_REIMBURSEMENTS',           1,1,0,0,1, 1, NOW()),
  (UUID(), 'admin',           'PAYROLL_REIMBURSEMENTS',           1,1,1,0,1, 1, NOW()),
  (UUID(), 'hr',              'PAYROLL_REIMBURSEMENTS',           1,0,0,0,1, 1, NOW()),
  (UUID(), 'employee',        'PAYROLL_REIMBURSEMENTS',           1,1,0,0,0, 1, NOW()),

  (UUID(), 'super_admin',     'PAYROLL_RUNNING_BREAKDOWN',        1,1,1,1,1, 1, NOW()),
  (UUID(), 'admin',           'PAYROLL_RUNNING_BREAKDOWN',        1,1,1,0,1, 1, NOW()),
  (UUID(), 'payroll_head',    'PAYROLL_RUNNING_BREAKDOWN',        1,1,1,0,1, 1, NOW()),
  (UUID(), 'payroll_branch',  'PAYROLL_RUNNING_BREAKDOWN',        1,1,1,0,1, 1, NOW()),
  (UUID(), 'wfm',             'PAYROLL_RUNNING_BREAKDOWN',        1,1,0,0,1, 1, NOW()),
  (UUID(), 'employee',        'PAYROLL_RUNNING_BREAKDOWN',        1,0,0,0,0, 1, NOW()),

  (UUID(), 'super_admin',     'PAYROLL_SIGN_OFF',                 1,1,1,1,1, 1, NOW()),
  (UUID(), 'payroll_head',    'PAYROLL_SIGN_OFF',                 1,1,1,0,1, 1, NOW()),
  (UUID(), 'finance',         'PAYROLL_SIGN_OFF',                 1,1,0,0,1, 1, NOW()),
  (UUID(), 'ceo',             'PAYROLL_SIGN_OFF',                 1,1,0,0,1, 1, NOW()),
  (UUID(), 'admin',           'PAYROLL_SIGN_OFF',                 1,1,1,0,1, 1, NOW()),

  (UUID(), 'super_admin',     'PAYROLL_STATUTORY_FILING',         1,1,1,1,1, 1, NOW()),
  (UUID(), 'payroll_head',    'PAYROLL_STATUTORY_FILING',         1,1,1,0,1, 1, NOW()),
  (UUID(), 'finance',         'PAYROLL_STATUTORY_FILING',         1,1,0,0,1, 1, NOW()),
  (UUID(), 'admin',           'PAYROLL_STATUTORY_FILING',         1,1,1,0,1, 1, NOW()),

  (UUID(), 'super_admin',     'PAYROLL_VALIDATION',               1,1,1,1,1, 1, NOW()),
  (UUID(), 'payroll_head',    'PAYROLL_VALIDATION',               1,1,1,0,1, 1, NOW()),

  (UUID(), 'super_admin',     'PAYROLL_VARIANCE',                 1,1,1,1,1, 1, NOW()),
  (UUID(), 'payroll_head',    'PAYROLL_VARIANCE',                 1,1,1,0,1, 1, NOW()),
  (UUID(), 'finance',         'PAYROLL_VARIANCE',                 1,1,0,0,1, 1, NOW()),
  (UUID(), 'admin',           'PAYROLL_VARIANCE',                 1,1,1,0,1, 1, NOW()),

  (UUID(), 'super_admin',     'WFM_ATTENDANCE_DASHBOARD',         1,1,1,1,1, 1, NOW()),
  (UUID(), 'wfm',             'WFM_ATTENDANCE_DASHBOARD',         1,1,1,0,1, 1, NOW()),
  (UUID(), 'ho_wfm',          'WFM_ATTENDANCE_DASHBOARD',         1,1,1,0,1, 1, NOW()),
  (UUID(), 'wfm_spoc',        'WFM_ATTENDANCE_DASHBOARD',         1,1,1,0,1, 1, NOW()),
  (UUID(), 'rta',             'WFM_ATTENDANCE_DASHBOARD',         1,1,0,0,1, 1, NOW()),
  (UUID(), 'hr',              'WFM_ATTENDANCE_DASHBOARD',         1,1,0,0,1, 1, NOW()),
  (UUID(), 'operations_manager','WFM_ATTENDANCE_DASHBOARD',       1,0,0,0,1, 1, NOW()),

  (UUID(), 'super_admin',     'WFM_PLANNING_RULES',               1,1,1,1,1, 1, NOW()),
  (UUID(), 'admin',           'WFM_PLANNING_RULES',               1,1,1,0,1, 1, NOW()),
  (UUID(), 'wfm',             'WFM_PLANNING_RULES',               1,1,1,0,1, 1, NOW()),

  (UUID(), 'super_admin',     'WFM_SLOT_REQUIREMENTS',            1,1,1,1,1, 1, NOW()),
  (UUID(), 'admin',           'WFM_SLOT_REQUIREMENTS',            1,1,1,0,1, 1, NOW()),
  (UUID(), 'wfm',             'WFM_SLOT_REQUIREMENTS',            1,1,1,0,1, 1, NOW()),

  (UUID(), 'super_admin',     'WFM_WEEKOFF_DAY_RULES',            1,1,1,1,1, 1, NOW()),
  (UUID(), 'admin',           'WFM_WEEKOFF_DAY_RULES',            1,1,1,0,1, 1, NOW()),
  (UUID(), 'wfm',             'WFM_WEEKOFF_DAY_RULES',            1,1,1,0,1, 1, NOW());

INSERT IGNORE INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status, created_at)
SELECT UUID(), 'super_admin', pc.page_code, 1,1,1,1,1, 1, NOW()
FROM page_catalog pc
WHERE pc.active_status = 1
  AND NOT EXISTS (
    SELECT 1
    FROM role_page_access rpa
    WHERE rpa.role_key = 'super_admin'
      AND rpa.page_code = pc.page_code
  );

INSERT IGNORE INTO schema_migrations (filename, applied_at)
VALUES ('538_route_page_access_backfill.sql', NOW());
