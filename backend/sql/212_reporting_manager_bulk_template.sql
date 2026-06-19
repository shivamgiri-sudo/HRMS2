-- Migration 212: seed REPORTING_MANAGER_UPDATE bulk upload template
-- Also seed OFFICIAL_EMAIL_UPDATE in case it was missed (INSERT IGNORE is safe)

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

SELECT '212_reporting_manager_bulk_template.sql applied successfully' AS migration_status;
