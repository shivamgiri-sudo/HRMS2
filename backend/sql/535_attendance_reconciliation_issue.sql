CREATE TABLE IF NOT EXISTS attendance_reconciliation_issue (
  id CHAR(36) NOT NULL PRIMARY KEY,
  issue_key VARCHAR(255) NOT NULL,
  issue_date DATE NOT NULL,
  employee_id CHAR(36) NULL,
  employee_code VARCHAR(50) NULL,
  cosec_user_id VARCHAR(100) NULL,
  issue_type ENUM(
    'unmapped_cosec_user',
    'missing_ibd',
    'zero_minute_attendance',
    'missing_punch_with_usable_source',
    'missing_adr'
  ) NOT NULL,
  severity ENUM('blocker','warning') NOT NULL DEFAULT 'blocker',
  source_minutes INT NOT NULL DEFAULT 0,
  hrms_minutes INT NULL,
  adr_status VARCHAR(50) NULL,
  source_payload_json JSON NULL,
  auto_fix_status ENUM('not_attempted','fixed','skipped','failed') NOT NULL DEFAULT 'not_attempted',
  auto_fix_reason VARCHAR(255) NULL,
  first_detected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_detected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  resolved_at DATETIME NULL,
  reviewed_by CHAR(36) NULL,
  reviewed_at DATETIME NULL,
  review_notes TEXT NULL,
  UNIQUE KEY uq_att_recon_issue_key (issue_key),
  KEY idx_att_recon_issue_date_status (issue_date, auto_fix_status, resolved_at),
  KEY idx_att_recon_issue_employee (employee_id, issue_date),
  KEY idx_att_recon_issue_type (issue_type, issue_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @col_1 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'attendance_reconciliation_issue' AND COLUMN_NAME = 'issue_key'
);
SET @sql_1 = IF(@col_1 = 0,
  'ALTER TABLE attendance_reconciliation_issue ADD COLUMN issue_key VARCHAR(255) NULL AFTER id',
  'SELECT "issue_key already exists" AS message');
PREPARE stmt_1 FROM @sql_1;
EXECUTE stmt_1;
DEALLOCATE PREPARE stmt_1;

UPDATE attendance_reconciliation_issue
   SET issue_key = CONCAT_WS('__',
     DATE_FORMAT(issue_date, '%Y-%m-%d'),
     issue_type,
     COALESCE(employee_id, ''),
     COALESCE(employee_code, ''),
     COALESCE(cosec_user_id, '')
   )
 WHERE issue_key IS NULL OR issue_key = '';

ALTER TABLE attendance_reconciliation_issue
  MODIFY issue_key VARCHAR(255) NOT NULL;

ALTER TABLE attendance_reconciliation_issue
  ADD UNIQUE KEY uq_att_recon_issue_key (issue_key);
