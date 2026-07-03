CREATE TABLE IF NOT EXISTS document_template_field_map (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  template_id CHAR(36) NULL,
  document_code VARCHAR(100) NOT NULL,
  field_key VARCHAR(120) NOT NULL,
  field_label VARCHAR(255) NOT NULL,
  source_path VARCHAR(255) NULL,
  page_no INT NOT NULL DEFAULT 1,
  x DECIMAL(10,2) NULL,
  y DECIMAL(10,2) NULL,
  width DECIMAL(10,2) NULL,
  height DECIMAL(10,2) NULL,
  font_size DECIMAL(10,2) NULL,
  font_weight VARCHAR(30) NULL,
  alignment VARCHAR(30) NULL,
  field_type VARCHAR(40) NOT NULL DEFAULT 'text',
  required TINYINT(1) NOT NULL DEFAULT 0,
  masking_rule VARCHAR(80) NULL,
  mapping_mode VARCHAR(40) NOT NULL DEFAULT 'placeholder',
  placeholder_token VARCHAR(150) NULL,
  pdf_field_name VARCHAR(150) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_document_template_field_map (document_code, field_key, page_no),
  INDEX idx_document_template_field_map_template (template_id)
);

CREATE TABLE IF NOT EXISTS employee_joining_document_field_value (
  id CHAR(36) NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  checklist_id CHAR(36) NOT NULL,
  employee_id CHAR(36) NOT NULL,
  document_code VARCHAR(100) NOT NULL,
  field_key VARCHAR(120) NOT NULL,
  field_label VARCHAR(255) NOT NULL,
  source_path VARCHAR(255) NULL,
  field_type VARCHAR(40) NOT NULL DEFAULT 'text',
  value_text TEXT NULL,
  masked_value TEXT NULL,
  value_source ENUM('SYSTEM','HR_ENTERED','EMPLOYEE_CONFIRMED','PAYROLL_ENTERED') NOT NULL DEFAULT 'SYSTEM',
  fill_status ENUM('draft_generated','auto_filled','hr_fill_required','hr_filled','employee_review_pending','correction_requested','ready_for_esign','esign_initiated','esign_failed','esign_completed','wet_signature_required','wet_signed_uploaded','hr_verification_pending','verified','reupload_required','completed') NOT NULL DEFAULT 'draft_generated',
  confidence_score DECIMAL(5,2) NULL,
  requires_confirmation TINYINT(1) NOT NULL DEFAULT 0,
  employee_confirmed TINYINT(1) NOT NULL DEFAULT 0,
  employee_confirmed_at DATETIME NULL,
  employee_confirmation_comment TEXT NULL,
  hr_reason TEXT NULL,
  created_by CHAR(36) NULL,
  updated_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_employee_joining_document_value (checklist_id, field_key),
  INDEX idx_employee_joining_document_value_employee (employee_id, document_code),
  CONSTRAINT fk_employee_joining_document_value_checklist FOREIGN KEY (checklist_id) REFERENCES employee_joining_document_checklist(id) ON DELETE CASCADE,
  CONSTRAINT fk_employee_joining_document_value_employee FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
);

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_joining_document_template' AND COLUMN_NAME = 'fill_mode') = 0,
  'ALTER TABLE employee_joining_document_template ADD COLUMN fill_mode VARCHAR(40) NOT NULL DEFAULT ''placeholder'' AFTER document_category, ADD COLUMN template_mime_type VARCHAR(120) NULL AFTER template_storage_path, ADD COLUMN template_schema_json JSON NULL AFTER template_mime_type',
  'SELECT ''employee_joining_document_template universal fill columns already exist'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_joining_document_checklist' AND COLUMN_NAME = 'fill_status') = 0,
  'ALTER TABLE employee_joining_document_checklist ADD COLUMN fill_status VARCHAR(80) NOT NULL DEFAULT ''draft_generated'' AFTER status, ADD COLUMN employee_review_status VARCHAR(40) NOT NULL DEFAULT ''pending'' AFTER fill_status, ADD COLUMN employee_reviewed_at DATETIME NULL AFTER employee_review_status, ADD COLUMN employee_review_comment TEXT NULL AFTER employee_reviewed_at, ADD COLUMN final_file_locked_at DATETIME NULL AFTER employee_review_comment, ADD COLUMN signature_mode VARCHAR(40) NULL AFTER final_file_locked_at',
  'SELECT ''employee_joining_document_checklist universal fill columns already exist'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
