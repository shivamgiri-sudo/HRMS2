-- Safety migration for live databases where migration 346 was skipped or partially applied.
-- Keeps joining-document and EPF compliance pages from failing with unknown status columns.

SET @employees_joining_status_sql = IF(
  (SELECT COUNT(*)
     FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'employees'
      AND COLUMN_NAME = 'joining_document_status') = 0,
  'ALTER TABLE employees ADD COLUMN joining_document_status VARCHAR(80) NULL',
  'SELECT ''employees.joining_document_status already exists'' AS note'
);
PREPARE stmt FROM @employees_joining_status_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @employees_joining_pct_sql = IF(
  (SELECT COUNT(*)
     FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'employees'
      AND COLUMN_NAME = 'joining_document_completion_pct') = 0,
  'ALTER TABLE employees ADD COLUMN joining_document_completion_pct DECIMAL(5,2) NOT NULL DEFAULT 0',
  'SELECT ''employees.joining_document_completion_pct already exists'' AS note'
);
PREPARE stmt FROM @employees_joining_pct_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @employees_joining_completed_sql = IF(
  (SELECT COUNT(*)
     FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'employees'
      AND COLUMN_NAME = 'joining_document_completed_at') = 0,
  'ALTER TABLE employees ADD COLUMN joining_document_completed_at DATETIME NULL',
  'SELECT ''employees.joining_document_completed_at already exists'' AS note'
);
PREPARE stmt FROM @employees_joining_completed_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @bridge_joining_status_sql = IF(
  (SELECT COUNT(*)
     FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ats_onboarding_bridge'
      AND COLUMN_NAME = 'joining_document_status') = 0,
  'ALTER TABLE ats_onboarding_bridge ADD COLUMN joining_document_status VARCHAR(80) NULL',
  'SELECT ''ats_onboarding_bridge.joining_document_status already exists'' AS note'
);
PREPARE stmt FROM @bridge_joining_status_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @bridge_joining_pct_sql = IF(
  (SELECT COUNT(*)
     FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ats_onboarding_bridge'
      AND COLUMN_NAME = 'joining_document_completion_pct') = 0,
  'ALTER TABLE ats_onboarding_bridge ADD COLUMN joining_document_completion_pct DECIMAL(5,2) NOT NULL DEFAULT 0',
  'SELECT ''ats_onboarding_bridge.joining_document_completion_pct already exists'' AS note'
);
PREPARE stmt FROM @bridge_joining_pct_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @bridge_joining_completed_sql = IF(
  (SELECT COUNT(*)
     FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ats_onboarding_bridge'
      AND COLUMN_NAME = 'joining_document_completed_at') = 0,
  'ALTER TABLE ats_onboarding_bridge ADD COLUMN joining_document_completed_at DATETIME NULL',
  'SELECT ''ats_onboarding_bridge.joining_document_completed_at already exists'' AS note'
);
PREPARE stmt FROM @bridge_joining_completed_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
