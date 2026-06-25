-- 308_email_templates_bulk_import.sql
-- Adds dedicated email_templates table with template_key (UNIQUE) for
-- bulk import feature. Also registers EMAIL_TEMPLATE_IMPORT in upload_template_master.
-- Additive only — does not touch communication_template or any existing table.

USE mas_hrms;

CREATE TABLE IF NOT EXISTS email_templates (
  id              CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  template_key    VARCHAR(100)  NOT NULL COMMENT 'Unique machine key e.g. HRMS_LOGIN_OTP',
  module_name     VARCHAR(100)  NOT NULL COMMENT 'Module: Authentication, Payroll, etc.',
  subject         VARCHAR(255)  NOT NULL,
  body_text       TEXT          NULL     COMMENT 'Plain-text version',
  body_html       MEDIUMTEXT    NULL     COMMENT 'HTML version (optional)',
  variables_json  JSON          NULL     COMMENT '["varName","varName2"] — auto-detected if blank',
  is_active       TINYINT(1)   NOT NULL DEFAULT 1,
  imported_via    VARCHAR(50)   NULL     COMMENT 'manual | bulk_import',
  imported_by     CHAR(36)      NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_template_key (template_key),
  INDEX idx_module_active (module_name, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Register the upload type so BulkUploadHub lists it
INSERT IGNORE INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description,
   required_columns, optional_columns, sample_row, active_status)
VALUES (
  UUID(),
  'EMAIL_TEMPLATE_IMPORT',
  'Email Template Bulk Import',
  'email_templates',
  'Import email notification templates from Excel/CSV. One template per row.',
  JSON_ARRAY('template_key','module_name','subject','body_text'),
  JSON_ARRAY('body_html','variables_json','is_active'),
  JSON_OBJECT(
    'template_key',   'HRMS_LOGIN_OTP',
    'module_name',    'Authentication',
    'subject',        'Your HRMS Login OTP',
    'body_text',      'Dear {{employeeName}}, your OTP is {{otp}}. Valid for {{expiryMinutes}} minutes.',
    'body_html',      '',
    'variables_json', '["employeeName","otp","expiryMinutes"]',
    'is_active',      '1'
  ),
  1
);
