-- 275_lms_mapping_schema_consolidation.sql
-- Additive: enriches lms_employee_mapping (created by 020) with mapping strategy columns
-- used by the canonical mapper. Safe to re-run (IF NOT EXISTS / IGNORE).

USE mas_hrms;

-- Add mapping strategy columns if absent
SET @col_exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lms_employee_mapping'
  AND COLUMN_NAME = 'mapping_source');
SET @ddl := IF(@col_exists = 0,
  "ALTER TABLE lms_employee_mapping
     ADD COLUMN mapping_source ENUM('mobile','personal_email','official_email','employee_code','manual') NULL AFTER is_active,
     ADD COLUMN mapping_confidence ENUM('high','medium','low') NULL AFTER mapping_source,
     ADD COLUMN hrms_employee_code VARCHAR(50) NULL AFTER mapping_confidence,
     ADD COLUMN mapped_by VARCHAR(100) NULL DEFAULT 'system' AFTER hrms_employee_code",
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Add index on mapping_confidence if absent
SET @idx_exists := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lms_employee_mapping'
  AND INDEX_NAME = 'idx_lms_mapping_confidence');
SET @ddl := IF(@idx_exists = 0,
  'CREATE INDEX idx_lms_mapping_confidence ON lms_employee_mapping (mapping_confidence)',
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- lms_mapping_audit — only create if migration 251 did not already run
CREATE TABLE IF NOT EXISTS lms_mapping_audit (
  id CHAR(36) PRIMARY KEY,
  lms_employee_id VARCHAR(128) NOT NULL,
  attempted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  tried_mobile VARCHAR(20),
  tried_personal_email VARCHAR(100),
  tried_official_email VARCHAR(100),
  tried_employee_code VARCHAR(50),
  mobile_match_found TINYINT(1) DEFAULT 0,
  email_personal_match_found TINYINT(1) DEFAULT 0,
  email_official_match_found TINYINT(1) DEFAULT 0,
  employee_code_match_found TINYINT(1) DEFAULT 0,
  final_match_source ENUM('mobile','personal_email','official_email','employee_code','none'),
  final_hrms_employee_id CHAR(36),
  success TINYINT(1) DEFAULT 0,
  error_reason TEXT,
  INDEX idx_lms_audit_emp (lms_employee_id),
  INDEX idx_lms_audit_success (success)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
