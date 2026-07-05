-- Migration 355: EPF Form 11 AcroForm phase 1
-- Extends existing template mapping and EPF profile tables only.

DROP PROCEDURE IF EXISTS _355_add_col;
DELIMITER $$
CREATE PROCEDURE _355_add_col(
  IN tbl VARCHAR(64),
  IN col VARCHAR(64),
  IN col_def TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = tbl
       AND COLUMN_NAME = col
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `', tbl, '` ADD COLUMN `', col, '` ', col_def);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$
DELIMITER ;

CALL _355_add_col('document_template_field_map', 'transform_rule', "VARCHAR(80) NULL AFTER pdf_field_name");
CALL _355_add_col('document_template_field_map', 'checked_when', "VARCHAR(100) NULL AFTER transform_rule");
CALL _355_add_col('document_template_field_map', 'min_font_size', "DECIMAL(10,2) NULL AFTER checked_when");
CALL _355_add_col('document_template_field_map', 'max_font_size', "DECIMAL(10,2) NULL AFTER min_font_size");
CALL _355_add_col('document_template_field_map', 'max_length', "INT NULL AFTER max_font_size");
CALL _355_add_col('document_template_field_map', 'validation_rule', "VARCHAR(120) NULL AFTER max_length");
CALL _355_add_col('document_template_field_map', 'overflow_strategy', "ENUM('shrink','wrap','block') NOT NULL DEFAULT 'shrink' AFTER validation_rule");

CALL _355_add_col('employee_epf_compliance_profile', 'previous_pf_account_number', "VARCHAR(100) NULL AFTER previous_pf_member");
CALL _355_add_col('employee_epf_compliance_profile', 'previous_exit_date', "DATE NULL AFTER previous_pf_account_number");
CALL _355_add_col('employee_epf_compliance_profile', 'scheme_certificate_number', "VARCHAR(100) NULL AFTER previous_exit_date");
CALL _355_add_col('employee_epf_compliance_profile', 'ppo_number', "VARCHAR(100) NULL AFTER scheme_certificate_number");
CALL _355_add_col('employee_epf_compliance_profile', 'country_of_origin', "VARCHAR(100) NULL AFTER international_worker");
CALL _355_add_col('employee_epf_compliance_profile', 'passport_number', "VARCHAR(50) NULL AFTER country_of_origin");
CALL _355_add_col('employee_epf_compliance_profile', 'passport_valid_from', "DATE NULL AFTER passport_number");
CALL _355_add_col('employee_epf_compliance_profile', 'passport_valid_to', "DATE NULL AFTER passport_valid_from");
CALL _355_add_col('employee_epf_compliance_profile', 'education_qualification', "VARCHAR(80) NULL AFTER passport_valid_to");
CALL _355_add_col('employee_epf_compliance_profile', 'specially_abled', "TINYINT(1) NOT NULL DEFAULT 0 AFTER education_qualification");
CALL _355_add_col('employee_epf_compliance_profile', 'disability_type', "VARCHAR(80) NULL AFTER specially_abled");
CALL _355_add_col('employee_epf_compliance_profile', 'aadhaar_name_as_per_kyc', "VARCHAR(255) NULL AFTER disability_type");
CALL _355_add_col('employee_epf_compliance_profile', 'pan_name_as_per_kyc', "VARCHAR(255) NULL AFTER aadhaar_name_as_per_kyc");
CALL _355_add_col('employee_epf_compliance_profile', 'bank_verification_status', "VARCHAR(40) NULL AFTER pan_name_as_per_kyc");
CALL _355_add_col('employee_epf_compliance_profile', 'pan_verification_status', "VARCHAR(40) NULL AFTER bank_verification_status");
CALL _355_add_col('employee_epf_compliance_profile', 'uan_verification_status', "VARCHAR(40) NULL AFTER pan_verification_status");

DROP PROCEDURE IF EXISTS _355_add_col;

UPDATE employee_joining_document_template
   SET fill_mode = 'acroform',
       template_mime_type = COALESCE(template_mime_type, 'application/pdf')
 WHERE document_code = 'EPF_DECLARATION'
   AND active_status = 1;

SELECT 'migration 355 epf acroform phase 1 complete' AS status;
