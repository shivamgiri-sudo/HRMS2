-- Migration 520: Seed missing page codes that are referenced in frontend Gate components
-- but were never inserted into page_catalog.
-- Safe to re-run (INSERT IGNORE + ON DUPLICATE KEY).
-- Does NOT drop or alter any existing rows.

-- ----------------------------------------------------------------
-- 1. page_catalog entries
-- ----------------------------------------------------------------
INSERT IGNORE INTO page_catalog (id, page_code, page_name, page_path, module, description, active_status, created_at)
VALUES
  (UUID(), 'SALARY_INCREMENT',              'Salary Increment',              '/salary-increment',                    'Payroll',     'Salary revision and increment workflow',                  1, NOW()),
  (UUID(), 'ORG_CHART',                     'Org Chart',                     '/org-chart',                           'People',      'Company hierarchy and reporting structure',               1, NOW()),
  (UUID(), 'VENDOR_MANAGEMENT',             'Vendor Management',             '/vendors',                             'Finance',     'Vendor master and contract management',                   1, NOW()),
  (UUID(), 'PROCUREMENT',                   'Procurement',                   '/procurement',                         'Finance',     'Procurement requests and approvals',                      1, NOW()),
  (UUID(), 'ATS_BULK_IMPORT',               'ATS Bulk Import',               '/ats/bulk-import',                     'ATS',         'Bulk candidate import from Excel/CSV',                    1, NOW()),
  (UUID(), 'ATS_JOINING_DOCUMENTS_TRACKER', 'Joining Documents Tracker',     '/ats/joining-documents-tracker',       'ATS',         'Track status of joining document collection per candidate', 1, NOW()),
  (UUID(), 'JOBS',                          'Job Listings',                  '/jobs',                                'ATS',         'Public and internal job postings',                        1, NOW());

-- ----------------------------------------------------------------
-- 2. role_page_access grants
-- ----------------------------------------------------------------

-- SALARY_INCREMENT — hr, payroll_hr, admin, super_admin
INSERT IGNORE INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status, created_at)
VALUES
  (UUID(), 'super_admin', 'SALARY_INCREMENT', 1,1,1,1,1, 1, NOW()),
  (UUID(), 'admin',       'SALARY_INCREMENT', 1,1,1,1,1, 1, NOW()),
  (UUID(), 'hr',          'SALARY_INCREMENT', 1,1,1,0,1, 1, NOW()),
  (UUID(), 'payroll_hr',  'SALARY_INCREMENT', 1,1,1,0,1, 1, NOW());

-- ORG_CHART — view for all roles
INSERT IGNORE INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status, created_at)
VALUES
  (UUID(), 'super_admin',       'ORG_CHART', 1,1,1,1,1, 1, NOW()),
  (UUID(), 'admin',             'ORG_CHART', 1,1,1,1,1, 1, NOW()),
  (UUID(), 'hr',                'ORG_CHART', 1,0,0,0,1, 1, NOW()),
  (UUID(), 'payroll_hr',        'ORG_CHART', 1,0,0,0,1, 1, NOW()),
  (UUID(), 'recruitment_hr',    'ORG_CHART', 1,0,0,0,1, 1, NOW()),
  (UUID(), 'wfm',               'ORG_CHART', 1,0,0,0,1, 1, NOW()),
  (UUID(), 'finance',           'ORG_CHART', 1,0,0,0,1, 1, NOW()),
  (UUID(), 'manager',           'ORG_CHART', 1,0,0,0,1, 1, NOW()),
  (UUID(), 'branch_head',       'ORG_CHART', 1,0,0,0,1, 1, NOW()),
  (UUID(), 'operations_head',   'ORG_CHART', 1,0,0,0,1, 1, NOW()),
  (UUID(), 'process_manager',   'ORG_CHART', 1,0,0,0,1, 1, NOW()),
  (UUID(), 'employee',          'ORG_CHART', 1,0,0,0,0, 1, NOW()),
  (UUID(), 'trainer',           'ORG_CHART', 1,0,0,0,0, 1, NOW()),
  (UUID(), 'qa',                'ORG_CHART', 1,0,0,0,0, 1, NOW()),
  (UUID(), 'client',            'ORG_CHART', 0,0,0,0,0, 1, NOW()),
  (UUID(), 'dpo',               'ORG_CHART', 1,0,0,0,0, 1, NOW()),
  (UUID(), 'compliance',        'ORG_CHART', 1,0,0,0,0, 1, NOW());

-- VENDOR_MANAGEMENT — admin, super_admin, finance, manager
INSERT IGNORE INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status, created_at)
VALUES
  (UUID(), 'super_admin', 'VENDOR_MANAGEMENT', 1,1,1,1,1, 1, NOW()),
  (UUID(), 'admin',       'VENDOR_MANAGEMENT', 1,1,1,1,1, 1, NOW()),
  (UUID(), 'finance',     'VENDOR_MANAGEMENT', 1,1,1,0,1, 1, NOW()),
  (UUID(), 'manager',     'VENDOR_MANAGEMENT', 1,0,0,0,1, 1, NOW());

-- PROCUREMENT — admin, super_admin, finance
INSERT IGNORE INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status, created_at)
VALUES
  (UUID(), 'super_admin', 'PROCUREMENT', 1,1,1,1,1, 1, NOW()),
  (UUID(), 'admin',       'PROCUREMENT', 1,1,1,1,1, 1, NOW()),
  (UUID(), 'finance',     'PROCUREMENT', 1,1,1,0,1, 1, NOW());

-- ATS_BULK_IMPORT — admin, super_admin only
INSERT IGNORE INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status, created_at)
VALUES
  (UUID(), 'super_admin',    'ATS_BULK_IMPORT', 1,1,1,1,1, 1, NOW()),
  (UUID(), 'admin',          'ATS_BULK_IMPORT', 1,1,1,1,1, 1, NOW()),
  (UUID(), 'recruitment_hr', 'ATS_BULK_IMPORT', 1,1,0,0,1, 1, NOW());

-- ATS_JOINING_DOCUMENTS_TRACKER — hr, admin, super_admin, payroll_hr
INSERT IGNORE INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status, created_at)
VALUES
  (UUID(), 'super_admin',    'ATS_JOINING_DOCUMENTS_TRACKER', 1,1,1,1,1, 1, NOW()),
  (UUID(), 'admin',          'ATS_JOINING_DOCUMENTS_TRACKER', 1,1,1,1,1, 1, NOW()),
  (UUID(), 'hr',             'ATS_JOINING_DOCUMENTS_TRACKER', 1,1,1,0,1, 1, NOW()),
  (UUID(), 'payroll_hr',     'ATS_JOINING_DOCUMENTS_TRACKER', 1,1,1,0,1, 1, NOW()),
  (UUID(), 'recruitment_hr', 'ATS_JOINING_DOCUMENTS_TRACKER', 1,1,0,0,1, 1, NOW());

-- JOBS — view for all roles, full for admin/super_admin/recruitment_hr
INSERT IGNORE INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status, created_at)
VALUES
  (UUID(), 'super_admin',     'JOBS', 1,1,1,1,1, 1, NOW()),
  (UUID(), 'admin',           'JOBS', 1,1,1,1,1, 1, NOW()),
  (UUID(), 'recruitment_hr',  'JOBS', 1,1,1,0,1, 1, NOW()),
  (UUID(), 'hr',              'JOBS', 1,1,0,0,1, 1, NOW()),
  (UUID(), 'manager',         'JOBS', 1,0,0,0,1, 1, NOW()),
  (UUID(), 'branch_head',     'JOBS', 1,0,0,0,1, 1, NOW()),
  (UUID(), 'operations_head', 'JOBS', 1,0,0,0,1, 1, NOW()),
  (UUID(), 'employee',        'JOBS', 1,0,0,0,0, 1, NOW());

-- ----------------------------------------------------------------
-- 3. Blanket super_admin grant for ALL pages in page_catalog
--    Super admin must be able to view every page unconditionally.
-- ----------------------------------------------------------------
INSERT IGNORE INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status, created_at)
SELECT UUID(), 'super_admin', pc.page_code, 1,1,1,1,1, 1, NOW()
FROM page_catalog pc
WHERE pc.active_status = 1
  AND NOT EXISTS (
    SELECT 1 FROM role_page_access rpa
    WHERE rpa.role_key = 'super_admin' AND rpa.page_code = pc.page_code
  );

-- ----------------------------------------------------------------
-- 4. Migration record
-- ----------------------------------------------------------------
INSERT IGNORE INTO schema_migrations (filename, applied_at)
VALUES ('520_missing_page_codes_seed.sql', NOW());
