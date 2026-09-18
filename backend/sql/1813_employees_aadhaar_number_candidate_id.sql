-- Migration 1813: Add employees.aadhaar_number and employees.candidate_id
--
-- Context: employee-creation-orchestrator.service.ts writes aadhaar_number
-- (full 12-digit Aadhaar for ESIC / PF filing) and candidate_id (FK back to
-- ats_candidate, needed for the Employee Master "Entry Date" join) in its
-- employees INSERT. Both columns are referenced in code comments dated
-- 2026-09-02 and "owner decision", but no migration created them.
-- The missing columns caused ER_BAD_FIELD_ERROR (Unknown column in field list)
-- on every offer approval, producing the generic 500 "quote reference …" error.
--
-- Safe to re-run: each statement is idempotent via the INFORMATION_SCHEMA guard.

-- 1. aadhaar_number — full 12-digit number for statutory filing.
--    Stored in plain text (same rule as pan_number); the encrypted copy lives
--    in aadhaar_number_encrypted (migration 515) and blind index in
--    aadhaar_blind_index (migration 1122). CHAR(12) is correct: Aadhaar is
--    always exactly 12 digits and we strip non-digits before storing.
SET @col = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'employees'
    AND COLUMN_NAME  = 'aadhaar_number'
);
SET @sql = IF(@col = 0,
  'ALTER TABLE employees ADD COLUMN aadhaar_number CHAR(12) NULL COMMENT ''Full 12-digit Aadhaar for ESIC/PF filing'' AFTER aadhaar_last4',
  'SELECT ''aadhaar_number already exists'' AS note'
);
PREPARE p FROM @sql; EXECUTE p; DEALLOCATE PREPARE p;

-- 2. candidate_id — FK back to ats_candidate.
--    Allows the Employee Master report's candidate_onboarding_profile join to
--    work for employees hired through the ATS (previously NULL for every such
--    employee, so the "Entry Date" column was blank for all new hires).
--    NULL for legacy-imported employees who have no ATS record.
SET @col2 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'employees'
    AND COLUMN_NAME  = 'candidate_id'
);
SET @sql2 = IF(@col2 = 0,
  'ALTER TABLE employees ADD COLUMN candidate_id CHAR(36) NULL COMMENT ''ats_candidate.id — NULL for legacy imports'' AFTER id',
  'SELECT ''candidate_id already exists'' AS note'
);
PREPARE p2 FROM @sql2; EXECUTE p2; DEALLOCATE PREPARE p2;

-- Index on candidate_id — the Employee Master join uses this.
SET @idx = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'employees'
    AND INDEX_NAME   = 'idx_employees_candidate_id'
);
SET @sql3 = IF(@idx = 0,
  'ALTER TABLE employees ADD INDEX idx_employees_candidate_id (candidate_id)',
  'SELECT ''idx_employees_candidate_id already exists'' AS note'
);
PREPARE p3 FROM @sql3; EXECUTE p3; DEALLOCATE PREPARE p3;
