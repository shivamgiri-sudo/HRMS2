-- Align ats_payroll_hr_validation with the current Payroll HR service contract.

SET @payroll_validation_status_sql = IF(
  (SELECT COUNT(*)
     FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ats_payroll_hr_validation'
      AND COLUMN_NAME = 'validation_status') > 0,
  'ALTER TABLE ats_payroll_hr_validation MODIFY COLUMN validation_status VARCHAR(40) NOT NULL DEFAULT ''pending''',
  'SELECT ''ats_payroll_hr_validation.validation_status missing'' AS note'
);
PREPARE stmt FROM @payroll_validation_status_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @payroll_branch_sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_payroll_hr_validation' AND COLUMN_NAME = 'branch_id') = 0,
  'ALTER TABLE ats_payroll_hr_validation ADD COLUMN branch_id CHAR(36) NULL AFTER candidate_id',
  'SELECT ''ats_payroll_hr_validation.branch_id already exists'' AS note'
);
PREPARE stmt FROM @payroll_branch_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @payroll_hr_sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_payroll_hr_validation' AND COLUMN_NAME = 'payroll_hr_id') = 0,
  'ALTER TABLE ats_payroll_hr_validation ADD COLUMN payroll_hr_id CHAR(36) NULL AFTER branch_id',
  'SELECT ''ats_payroll_hr_validation.payroll_hr_id already exists'' AS note'
);
PREPARE stmt FROM @payroll_hr_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @company_sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_payroll_hr_validation' AND COLUMN_NAME = 'company_id') = 0,
  'ALTER TABLE ats_payroll_hr_validation ADD COLUMN company_id CHAR(36) NULL AFTER employment_type',
  'SELECT ''ats_payroll_hr_validation.company_id already exists'' AS note'
);
PREPARE stmt FROM @company_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @designation_sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_payroll_hr_validation' AND COLUMN_NAME = 'designation_id') = 0,
  'ALTER TABLE ats_payroll_hr_validation ADD COLUMN designation_id CHAR(36) NULL AFTER company_id',
  'SELECT ''ats_payroll_hr_validation.designation_id already exists'' AS note'
);
PREPARE stmt FROM @designation_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @department_sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_payroll_hr_validation' AND COLUMN_NAME = 'department_id') = 0,
  'ALTER TABLE ats_payroll_hr_validation ADD COLUMN department_id CHAR(36) NULL AFTER designation_id',
  'SELECT ''ats_payroll_hr_validation.department_id already exists'' AS note'
);
PREPARE stmt FROM @department_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @process_sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_payroll_hr_validation' AND COLUMN_NAME = 'process_id') = 0,
  'ALTER TABLE ats_payroll_hr_validation ADD COLUMN process_id CHAR(36) NULL AFTER department_id',
  'SELECT ''ats_payroll_hr_validation.process_id already exists'' AS note'
);
PREPARE stmt FROM @process_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @cost_centre_sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_payroll_hr_validation' AND COLUMN_NAME = 'cost_centre_id') = 0,
  'ALTER TABLE ats_payroll_hr_validation ADD COLUMN cost_centre_id CHAR(36) NULL AFTER process_id',
  'SELECT ''ats_payroll_hr_validation.cost_centre_id already exists'' AS note'
);
PREPARE stmt FROM @cost_centre_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @reporting_manager_sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_payroll_hr_validation' AND COLUMN_NAME = 'reporting_manager_id') = 0,
  'ALTER TABLE ats_payroll_hr_validation ADD COLUMN reporting_manager_id CHAR(36) NULL AFTER cost_centre_id',
  'SELECT ''ats_payroll_hr_validation.reporting_manager_id already exists'' AS note'
);
PREPARE stmt FROM @reporting_manager_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @salary_slab_sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_payroll_hr_validation' AND COLUMN_NAME = 'salary_slab_id') = 0,
  'ALTER TABLE ats_payroll_hr_validation ADD COLUMN salary_slab_id CHAR(36) NULL AFTER reporting_manager_id',
  'SELECT ''ats_payroll_hr_validation.salary_slab_id already exists'' AS note'
);
PREPARE stmt FROM @salary_slab_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @salary_components_sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_payroll_hr_validation' AND COLUMN_NAME = 'salary_components') = 0,
  'ALTER TABLE ats_payroll_hr_validation ADD COLUMN salary_components JSON NULL AFTER gross_salary',
  'SELECT ''ats_payroll_hr_validation.salary_components already exists'' AS note'
);
PREPARE stmt FROM @salary_components_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @shift_sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_payroll_hr_validation' AND COLUMN_NAME = 'shift_id') = 0,
  'ALTER TABLE ats_payroll_hr_validation ADD COLUMN shift_id CHAR(36) NULL AFTER salary_start_date',
  'SELECT ''ats_payroll_hr_validation.shift_id already exists'' AS note'
);
PREPARE stmt FROM @shift_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

