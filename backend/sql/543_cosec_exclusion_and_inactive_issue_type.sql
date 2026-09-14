CREATE TABLE IF NOT EXISTS attendance_reconciliation_cosec_exclusion (
  cosec_user_id VARCHAR(100) NOT NULL PRIMARY KEY,
  exclusion_reason VARCHAR(255) NOT NULL,
  notes TEXT NULL,
  active_status TINYINT(1) NOT NULL DEFAULT 1,
  created_by VARCHAR(100) NOT NULL DEFAULT 'system',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_att_recon_cosec_exclusion_active (active_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE attendance_reconciliation_issue
  MODIFY issue_type ENUM(
    'unmapped_cosec_user',
    'missing_ibd',
    'zero_minute_attendance',
    'missing_punch_with_usable_source',
    'missing_adr',
    'apr_missing_adr',
    'apr_minutes_mismatch',
    'apr_source_fallback_when_apr_exists',
    'approved_regularization_missing_adr',
    'salary_payable_days_mismatch',
    'dialler_source_without_evidence',
    'inactive_cosec_user_activity'
  ) NOT NULL;
