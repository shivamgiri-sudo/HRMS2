-- Migration 529: Add REPORTS_CENTER page code and role permissions
-- This fixes the reports page being blocked for all roles including Super Admin
-- Date: 2026-07-23

-- ----------------------------------------------------------------
-- 1. Add REPORTS_CENTER to page_catalog
-- ----------------------------------------------------------------
INSERT INTO page_catalog (page_code, page_name, module, page_path, description, active_status)
VALUES ('REPORTS_CENTER', 'Reports Center', 'Reports', '/reports', 'Workforce, attendance, payroll, compliance and productivity reports', 1)
ON DUPLICATE KEY UPDATE active_status = 1, page_name = 'Reports Center';

-- ----------------------------------------------------------------
-- 2. Grant permissions to appropriate roles
-- ----------------------------------------------------------------
INSERT INTO role_page_access (role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  -- Full access for admin roles
  ('super_admin',      'REPORTS_CENTER', 1, 1, 1, 1, 1, 1),
  ('admin',            'REPORTS_CENTER', 1, 1, 1, 1, 1, 1),

  -- HR roles - view and export
  ('hr',               'REPORTS_CENTER', 1, 0, 0, 0, 1, 1),
  ('hr_head',          'REPORTS_CENTER', 1, 0, 0, 0, 1, 1),

  -- Finance/Payroll - view and export
  ('finance',          'REPORTS_CENTER', 1, 0, 0, 0, 1, 1),
  ('payroll',          'REPORTS_CENTER', 1, 0, 0, 0, 1, 1),

  -- WFM - view and export
  ('wfm',              'REPORTS_CENTER', 1, 0, 0, 0, 1, 1),

  -- Management roles - view and export
  ('manager',          'REPORTS_CENTER', 1, 0, 0, 0, 1, 1),
  ('process_manager',  'REPORTS_CENTER', 1, 0, 0, 0, 1, 1),
  ('branch_head',      'REPORTS_CENTER', 1, 0, 0, 0, 1, 1),
  ('ceo',              'REPORTS_CENTER', 1, 0, 0, 0, 1, 1),

  -- Operations roles - view and export
  ('quality',          'REPORTS_CENTER', 1, 0, 0, 0, 1, 1),
  ('operations',       'REPORTS_CENTER', 1, 0, 0, 0, 1, 1),
  ('operations_head',  'REPORTS_CENTER', 1, 0, 0, 0, 1, 1)
ON DUPLICATE KEY UPDATE can_view = 1, active_status = 1;

-- ----------------------------------------------------------------
-- 3. Migration record
-- ----------------------------------------------------------------
INSERT IGNORE INTO schema_migrations (filename, applied_at)
VALUES ('529_reports_center_page_access.sql', NOW());
