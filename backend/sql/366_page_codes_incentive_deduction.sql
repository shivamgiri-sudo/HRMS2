-- Migration 366: Page catalog entries for incentive/deduction type management
-- Adds page codes for the new "Custom Deductions" and updated Incentive Types UI
-- Safe to re-run: INSERT IGNORE

INSERT IGNORE INTO page_catalog (id, page_code, page_name, module, description, active_status) VALUES
  (UUID(), 'PAYROLL_DEDUCTION_TYPES',   'Deduction Types',      'payroll', 'Manage custom deduction type master', 1),
  (UUID(), 'PAYROLL_DEDUCTION_UPLOAD',  'Custom Deductions Upload', 'payroll', 'Bulk upload custom deductions per employee', 1);

-- Grant to super_admin and payroll roles
INSERT IGNORE INTO role_page_access (id, role_key, page_code, can_view, can_edit)
SELECT UUID(), r.role_key, p.page_code, 1, 1
FROM (SELECT 'super_admin' AS role_key UNION SELECT 'payroll' UNION SELECT 'hr_admin' UNION SELECT 'finance') r
CROSS JOIN (
  SELECT page_code FROM page_catalog
  WHERE page_code IN ('PAYROLL_DEDUCTION_TYPES','PAYROLL_DEDUCTION_UPLOAD')
) p;
