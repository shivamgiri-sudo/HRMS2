-- Migration 343: seed the 7 core master upload templates that drive BulkUploadHub
-- INSERT IGNORE is fully idempotent — safe to re-run, no duplicates possible
-- upload_type_code is UNIQUE, so any row that already exists is silently skipped.

INSERT IGNORE INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description,
   required_columns, optional_columns, sample_row, active_status)
VALUES (
  UUID(),
  'EMPLOYEE_MASTER',
  'Employee Master Bulk Import',
  'employees',
  'Bulk import new employees into HRMS. EmployeeCode must be unique. HireDate and DateOfBirth must be DD-MM-YYYY. WorkingDays must be quoted CSV integers (e.g. "1,2,3,4,5").',
  JSON_ARRAY('EmployeeCode','FirstName','LastName','Email','Designation','HireDate'),
  JSON_ARRAY('Phone','Department','ManagerCode','ManagerEmail','DateOfBirth','Gender','Address','City','Country','EmploymentType','Status','WorkingHoursStart','WorkingHoursEnd','WorkingDays'),
  JSON_OBJECT(
    'EmployeeCode','TEST001','FirstName','Amit','LastName','Kumar',
    'Email','amit.test001@example.com','Designation','Executive','HireDate','16-05-2026',
    'Phone','9876543210','Department','Operations','ManagerCode','','ManagerEmail','',
    'DateOfBirth','01-01-1995','Gender','Male','Address','Demo Address','City','Delhi',
    'Country','India','EmploymentType','full-time','Status','active',
    'WorkingHoursStart','09:00','WorkingHoursEnd','18:00','WorkingDays','1,2,3,4,5'
  ),
  1
);

INSERT IGNORE INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description,
   required_columns, optional_columns, sample_row, active_status)
VALUES (
  UUID(),
  'PROCESS_MASTER',
  'Process Master Bulk Import',
  'process_master',
  'Bulk import process master records. ProcessCode must be unique. DepartmentName must exactly match an existing HRMS department.',
  JSON_ARRAY('process_code','process_name','department_name'),
  JSON_ARRAY('process_type','branch_name','location_name','active_status','description'),
  JSON_OBJECT(
    'process_code','ONF_KYC','process_name','Onfido KYC',
    'department_name','Operations','process_type','BPO',
    'branch_name','Okaya','location_name','Noida',
    'active_status','true','description','KYC backend process'
  ),
  1
);

INSERT IGNORE INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description,
   required_columns, optional_columns, sample_row, active_status)
VALUES (
  UUID(),
  'DEPARTMENT_MASTER',
  'Department Master Bulk Import',
  'departments',
  'Bulk import department master records. DepartmentName must be unique. Keep ManagerCode and ManagerEmail blank unless the manager already exists in HRMS.',
  JSON_ARRAY('DepartmentName'),
  JSON_ARRAY('Description','ManagerCode','ManagerEmail'),
  JSON_OBJECT(
    'DepartmentName','Operations Support',
    'Description','Operations support department',
    'ManagerCode','','ManagerEmail',''
  ),
  1
);

INSERT IGNORE INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description,
   required_columns, optional_columns, sample_row, active_status)
VALUES (
  UUID(),
  'ASSET_MASTER',
  'Asset Master Bulk Import',
  'assets',
  'Bulk import asset records. AssetCode must be unique. Status must be: available, assigned, maintenance, retired, or lost. Dates must be DD-MM-YYYY.',
  JSON_ARRAY('AssetCode','AssetName','Category','Status'),
  JSON_ARRAY('SerialNumber','PurchaseDate','PurchaseCost','Vendor','WarrantyEndDate','Notes'),
  JSON_OBJECT(
    'AssetCode','AST001','AssetName','Dell Laptop','Category','Laptop',
    'Status','available','SerialNumber','SN-DEMO-001',
    'PurchaseDate','16-05-2026','PurchaseCost','45000',
    'Vendor','Demo Vendor','WarrantyEndDate','16-05-2027',
    'Notes','Imported from Bulk Upload Hub'
  ),
  1
);

INSERT IGNORE INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description,
   required_columns, optional_columns, sample_row, active_status)
VALUES (
  UUID(),
  'BRANCH_MASTER',
  'Branch Master Bulk Import',
  'branches',
  'Bulk import branch master records. BranchCode must be unique (e.g. OKAYA, TPZ). ActiveStatus should be true or false.',
  JSON_ARRAY('BranchCode','BranchName'),
  JSON_ARRAY('City','State','Country','ActiveStatus','Description'),
  JSON_OBJECT(
    'BranchCode','OKAYA','BranchName','Okaya',
    'City','Noida','State','Uttar Pradesh','Country','India',
    'ActiveStatus','true','Description','Imported branch master record'
  ),
  1
);

INSERT IGNORE INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description,
   required_columns, optional_columns, sample_row, active_status)
VALUES (
  UUID(),
  'LOB_MASTER',
  'LOB Master Bulk Import',
  'lob_master',
  'Bulk import Line of Business records. LOBCode must be unique. ProcessCode or ProcessName should match an existing Process Master record.',
  JSON_ARRAY('LOBCode','LOBName'),
  JSON_ARRAY('ProcessCode','ProcessName','ActiveStatus','Description'),
  JSON_OBJECT(
    'LOBCode','ONF_KYC','LOBName','KYC',
    'ProcessCode','ONF_KYC','ProcessName','Onfido KYC',
    'ActiveStatus','true','Description','Imported LOB master record'
  ),
  1
);

INSERT IGNORE INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description,
   required_columns, optional_columns, sample_row, active_status)
VALUES (
  UUID(),
  'DESIGNATION_MASTER',
  'Designation Master Bulk Import',
  'designations',
  'Bulk import designation master records. DesignationCode must be unique. DepartmentName should exactly match an existing HRMS department.',
  JSON_ARRAY('DesignationCode','DesignationName'),
  JSON_ARRAY('DepartmentName','Level','ActiveStatus','Description'),
  JSON_OBJECT(
    'DesignationCode','EXEC','DesignationName','Executive',
    'DepartmentName','Operations','Level','L1',
    'ActiveStatus','true','Description','Imported designation master record'
  ),
  1
);

SELECT '343_core_master_upload_templates.sql applied successfully — 7 core master templates seeded' AS migration_status;
