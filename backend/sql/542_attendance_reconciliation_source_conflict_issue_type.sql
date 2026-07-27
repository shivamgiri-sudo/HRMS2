ALTER TABLE attendance_reconciliation_issue
  MODIFY issue_type ENUM(
    'unmapped_cosec_user',
    'missing_ibd',
    'zero_minute_attendance',
    'missing_punch_with_usable_source',
    'dialler_source_without_evidence',
    'missing_adr',
    'apr_missing_adr',
    'apr_minutes_mismatch',
    'apr_source_fallback_when_apr_exists',
    'approved_regularization_missing_adr',
    'salary_payable_days_mismatch'
  ) NOT NULL;
