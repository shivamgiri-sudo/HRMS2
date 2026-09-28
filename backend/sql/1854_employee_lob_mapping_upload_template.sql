-- 1853_employee_lob_mapping_upload_template.sql
-- Registers the "Employee LOB Mapping" bulk-upload type (EMPLOYEE_LOB_MAPPING) in
-- upload_template_master so it appears in the Bulk Upload Hub. Two columns only:
-- employee_code and lob_code, both required. The importer
-- (backend/src/modules/bulk-upload/employee-lob-bulk.service.ts) sets employees.lob_id and
-- rejects, per row, an employee outside the uploader's scope, an unknown/inactive LOB, or a LOB
-- that is not actively mapped to the employee's process in process_lob_map.
--
-- No page-access change: the Hub page (BULK_UPLOAD) is unchanged and the import itself is
-- role-gated in bulk-dispatch.ts (assertEmployeeLobUploader).
-- Additive and replay-safe: inserts only when no row with this upload_type_code exists.
-- Rollback: DELETE FROM upload_template_master WHERE upload_type_code = 'EMPLOYEE_LOB_MAPPING';

INSERT INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description,
   required_columns, optional_columns, sample_row, active_status)
SELECT UUID(), 'EMPLOYEE_LOB_MAPPING', 'Employee LOB Mapping', 'employees',
       'Assign each employee to a LOB (LOB must be mapped to their process in Process LOB Mapping). Employee must be active and inside your branch/process scope. Blank cells are rejected; this upload does not clear a LOB.',
       JSON_ARRAY('employee_code', 'lob_code'),
       JSON_ARRAY(),
       JSON_OBJECT('employee_code', 'MAS00001', 'lob_code', 'ONF_KYC'),
       1
  FROM DUAL
 WHERE NOT EXISTS (
   SELECT 1 FROM upload_template_master WHERE upload_type_code = 'EMPLOYEE_LOB_MAPPING'
 );
