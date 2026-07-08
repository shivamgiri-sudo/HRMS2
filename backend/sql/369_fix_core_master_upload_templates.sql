-- Migration 344: fix column names in the 7 core master upload templates
-- Migration 343 seeded them with invented PascalCase column names.
-- This UPDATE corrects every template to use the exact column names that
-- the importer services will read, matching the real DB schema.
-- Safe to re-run — UPDATE by upload_type_code is idempotent.

-- ── EMPLOYEE_MASTER ───────────────────────────────────────────────────────────
-- target: employees table
-- FK lookups: branch_code→branch_master, department_code→department_master(dept_code),
--             designation_code→designation_master, process_code→process_master,
--             lob_code→lob_master, manager_code→employees(employee_code)
UPDATE upload_template_master SET
  upload_type_name  = 'Employee Master Bulk Import',
  target_table      = 'employees',
  description       = 'Bulk import or update employees. employee_code is the upsert key — existing records are updated, new ones are inserted. date_of_joining and date_of_birth must be DD-MM-YYYY. working_days must be quoted comma-separated integers e.g. "1,2,3,4,5" (Mon=1…Sun=7). FK fields (branch_code, department_code, designation_code, process_code, lob_code, manager_code) must match existing master records.',
  required_columns  = JSON_ARRAY('employee_code','first_name','last_name','date_of_joining'),
  optional_columns  = JSON_ARRAY(
    'email','mobile','gender','date_of_birth','employment_type','employment_status',
    'branch_code','department_code','designation_code','process_code','lob_code','manager_code',
    'working_hours_start','working_hours_end','working_days',
    'city','state','country','address_line1','biometric_code','band','shift_rotation_type'
  ),
  sample_row        = JSON_OBJECT(
    'employee_code','MAS00001',
    'first_name','Amit',
    'last_name','Kumar',
    'date_of_joining','16-05-2026',
    'email','amit.kumar@example.com',
    'mobile','9876543210',
    'gender','Male',
    'date_of_birth','01-01-1995',
    'employment_type','full-time',
    'employment_status','Active',
    'branch_code','HQ',
    'department_code','OPS',
    'designation_code','HR_EXEC',
    'process_code','ONFIDO',
    'lob_code','INBOUND',
    'manager_code','',
    'working_hours_start','09:00',
    'working_hours_end','18:00',
    'working_days','1,2,3,4,5',
    'city','Delhi',
    'state','Delhi',
    'country','India',
    'address_line1','',
    'biometric_code','',
    'band','',
    'shift_rotation_type','frozen'
  )
WHERE upload_type_code = 'EMPLOYEE_MASTER';

-- ── PROCESS_MASTER ────────────────────────────────────────────────────────────
-- target: process_master table
-- workload_type enum: inbound_voice | outbound_voice | chat | email |
--                     backoffice | data_verification | audit_quality | blended
-- FK: branch_code→branch_master
UPDATE upload_template_master SET
  upload_type_name  = 'Process Master Bulk Import',
  target_table      = 'process_master',
  description       = 'Bulk import or update process master records. process_code is the upsert key. workload_type must be one of: inbound_voice, outbound_voice, chat, email, backoffice, data_verification, audit_quality, blended. branch_code must match an existing branch_master record.',
  required_columns  = JSON_ARRAY('process_code','process_name'),
  optional_columns  = JSON_ARRAY('workload_type','business_lob','branch_code','client_name','active_status'),
  sample_row        = JSON_OBJECT(
    'process_code','ONFIDO',
    'process_name','Onfido KYC',
    'workload_type','backoffice',
    'business_lob','KYC',
    'branch_code','HQ',
    'client_name','Onfido',
    'active_status','1'
  )
WHERE upload_type_code = 'PROCESS_MASTER';

-- ── DEPARTMENT_MASTER ─────────────────────────────────────────────────────────
-- target: department_master table (PK key: dept_code)
UPDATE upload_template_master SET
  upload_type_name  = 'Department Master Bulk Import',
  target_table      = 'department_master',
  description       = 'Bulk import or update department master records. dept_code is the upsert key — existing records are updated, new ones are inserted.',
  required_columns  = JSON_ARRAY('dept_code','dept_name'),
  optional_columns  = JSON_ARRAY('description','active_status'),
  sample_row        = JSON_OBJECT(
    'dept_code','OPS',
    'dept_name','Operations',
    'description','Operations floor department',
    'active_status','1'
  )
WHERE upload_type_code = 'DEPARTMENT_MASTER';

-- ── ASSET_MASTER ──────────────────────────────────────────────────────────────
-- target: asset_master table
-- status enum: available | assigned | maintenance | repair | retired | lost
-- purchase_date and warranty_expiry must be DD-MM-YYYY
-- branch_code→branch_master (optional FK)
UPDATE upload_template_master SET
  upload_type_name  = 'Asset Master Bulk Import',
  target_table      = 'asset_master',
  description       = 'Bulk import or update asset records. asset_code is the upsert key. status must be one of: available, assigned, maintenance, repair, retired, lost. purchase_date and warranty_expiry must be DD-MM-YYYY. branch_code must match an existing branch_master record if provided.',
  required_columns  = JSON_ARRAY('asset_code','asset_name','asset_category','status'),
  optional_columns  = JSON_ARRAY('asset_type','serial_number','purchase_date','purchase_cost','vendor','warranty_expiry','notes','branch_code'),
  sample_row        = JSON_OBJECT(
    'asset_code','AST001',
    'asset_name','Dell Laptop',
    'asset_category','Laptop',
    'status','available',
    'asset_type','Hardware',
    'serial_number','SN-DEMO-001',
    'purchase_date','16-05-2026',
    'purchase_cost','45000',
    'vendor','Demo Vendor',
    'warranty_expiry','16-05-2027',
    'notes','',
    'branch_code','HQ'
  )
WHERE upload_type_code = 'ASSET_MASTER';

-- ── BRANCH_MASTER ─────────────────────────────────────────────────────────────
-- target: branch_master table
UPDATE upload_template_master SET
  upload_type_name  = 'Branch Master Bulk Import',
  target_table      = 'branch_master',
  description       = 'Bulk import or update branch master records. branch_code is the upsert key. call_centre_code must be unique across all branches if provided.',
  required_columns  = JSON_ARRAY('branch_code','branch_name'),
  optional_columns  = JSON_ARRAY('city','state','active_status','call_centre_code','display_name'),
  sample_row        = JSON_OBJECT(
    'branch_code','OKAYA',
    'branch_name','Okaya',
    'city','Noida',
    'state','Uttar Pradesh',
    'active_status','1',
    'call_centre_code','',
    'display_name','Okaya Branch'
  )
WHERE upload_type_code = 'BRANCH_MASTER';

-- ── LOB_MASTER ────────────────────────────────────────────────────────────────
-- target: lob_master table
UPDATE upload_template_master SET
  upload_type_name  = 'LOB Master Bulk Import',
  target_table      = 'lob_master',
  description       = 'Bulk import or update Line of Business records. lob_code is the upsert key.',
  required_columns  = JSON_ARRAY('lob_code','lob_name'),
  optional_columns  = JSON_ARRAY('active_status'),
  sample_row        = JSON_OBJECT(
    'lob_code','INBOUND',
    'lob_name','Inbound Operations',
    'active_status','1'
  )
WHERE upload_type_code = 'LOB_MASTER';

-- ── DESIGNATION_MASTER ────────────────────────────────────────────────────────
-- target: designation_master table
-- grade is a free-text label e.g. L1, L2 (grade_id FK is resolved internally)
UPDATE upload_template_master SET
  upload_type_name  = 'Designation Master Bulk Import',
  target_table      = 'designation_master',
  description       = 'Bulk import or update designation master records. designation_code is the upsert key. grade is a free-text level label e.g. L1, L2, L3.',
  required_columns  = JSON_ARRAY('designation_code','designation_name'),
  optional_columns  = JSON_ARRAY('grade','active_status'),
  sample_row        = JSON_OBJECT(
    'designation_code','EXEC',
    'designation_name','Executive',
    'grade','L1',
    'active_status','1'
  )
WHERE upload_type_code = 'DESIGNATION_MASTER';

SELECT
  upload_type_code,
  JSON_LENGTH(required_columns) AS req_cols,
  JSON_LENGTH(optional_columns) AS opt_cols
FROM upload_template_master
WHERE upload_type_code IN (
  'EMPLOYEE_MASTER','PROCESS_MASTER','DEPARTMENT_MASTER',
  'ASSET_MASTER','BRANCH_MASTER','LOB_MASTER','DESIGNATION_MASTER'
)
ORDER BY upload_type_code;
