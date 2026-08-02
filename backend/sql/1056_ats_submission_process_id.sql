-- Add process_id FK to ats_interview_submission so the stored process name
-- is anchored to process_master. Nullable so existing rows are unaffected.
-- Uses conditional approach for MySQL (ADD COLUMN IF NOT EXISTS is MariaDB only).

SET @dbname = DATABASE();

-- Add process_id column if it does not already exist
SET @col_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @dbname
    AND TABLE_NAME   = 'ats_interview_submission'
    AND COLUMN_NAME  = 'process_id'
);
SET @sql = IF(@col_exists > 0,
  'SELECT "process_id column already exists" AS info',
  'ALTER TABLE ats_interview_submission ADD COLUMN process_id CHAR(36) NULL AFTER interviewed_for_process'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Add FK constraint if it does not already exist
SET @fk_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA    = @dbname
    AND TABLE_NAME      = 'ats_interview_submission'
    AND CONSTRAINT_NAME = 'fk_ais_process'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @sql2 = IF(@fk_exists > 0,
  'SELECT "fk_ais_process already exists" AS info',
  'ALTER TABLE ats_interview_submission ADD CONSTRAINT fk_ais_process FOREIGN KEY (process_id) REFERENCES process_master(id) ON DELETE SET NULL ON UPDATE CASCADE'
);
PREPARE stmt2 FROM @sql2;
EXECUTE stmt2;
DEALLOCATE PREPARE stmt2;
