-- Migration 222: ensure OFFICIAL_EMAIL_UPDATE and REPORTING_MANAGER_UPDATE templates exist
-- INSERT IGNORE is idempotent — safe to re-run even if already seeded

INSERT IGNORE INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description,
   required_columns, optional_columns, sample_row, active_status)
VALUES (
  UUID(),
  'OFFICIAL_EMAIL_UPDATE',
  'Official Email Bulk Update',
  'employees',
  'Bulk-assign official company email to existing employees. Email must be @teammas.in or @teammas.co.in',
  JSON_ARRAY('employee_code', 'official_email'),
  JSON_ARRAY(),
  JSON_OBJECT('employee_code', 'MAS00001', 'official_email', 'firstname.lastname@teammas.in'),
  1
);

INSERT IGNORE INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description,
   required_columns, optional_columns, sample_row, active_status)
VALUES (
  UUID(),
  'REPORTING_MANAGER_UPDATE',
  'Reporting Manager Bulk Update',
  'employees',
  'Bulk-assign reporting manager to existing employees. Both employee_code and manager_code must be active employee codes in HRMS.',
  JSON_ARRAY('employee_code', 'manager_code'),
  JSON_ARRAY(),
  JSON_OBJECT('employee_code', 'MAS00001', 'manager_code', 'MAS00100'),
  1
);

SELECT '222_ensure_bulk_upload_templates.sql applied successfully' AS migration_status;
