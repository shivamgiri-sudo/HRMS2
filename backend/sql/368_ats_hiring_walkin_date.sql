-- 368_ats_hiring_walkin_date.sql
-- Add walkin_date to hiring activity table

USE mas_hrms;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_recruiter_hiring_activity' AND COLUMN_NAME = 'walkin_date') = 0,
  'ALTER TABLE ats_recruiter_hiring_activity ADD COLUMN walkin_date DATE NULL COMMENT ''Walk-in scheduled date for If Interested outcome''',
  'SELECT ''walkin_date already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_recruiter_hiring_activity' AND INDEX_NAME = 'idx_arha_walkin_date') = 0,
  'CREATE INDEX idx_arha_walkin_date ON ats_recruiter_hiring_activity (walkin_date)',
  'SELECT ''idx_arha_walkin_date already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
