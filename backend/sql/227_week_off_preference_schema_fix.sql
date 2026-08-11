-- ============================================================
-- Migration 227: week_off_preference schema fix
-- Adds columns that backend services reference but never existed
-- in the original migration 060/061 schema.
--
-- SAFE: ADD COLUMN IF NOT EXISTS — MySQL 8.0 confirmed.
-- All columns are nullable or have defaults → zero impact on existing rows.
-- Old columns (preferred_day, alternate_day, approved) are KEPT
-- so existing wfm.routes.ts /week-off-preference endpoints keep working.
--
-- ROLLBACK (if needed before any data is written to new columns):
--   ALTER TABLE week_off_preference
--     DROP COLUMN IF EXISTS week_start_date,
--     DROP COLUMN IF EXISTS process_id,
--     DROP COLUMN IF EXISTS branch_id,
--     DROP COLUMN IF EXISTS preferred_day_1,
--     DROP COLUMN IF EXISTS preferred_day_2,
--     DROP COLUMN IF EXISTS reason,
--     DROP COLUMN IF EXISTS status,
--     DROP COLUMN IF EXISTS manager_remarks,
--     DROP COLUMN IF EXISTS reviewed_at,
--     DROP COLUMN IF EXISTS created_by;
--   DROP INDEX IF EXISTS idx_wop_process_week ON week_off_preference;
--   DROP INDEX IF EXISTS idx_wop_status ON week_off_preference;
-- ============================================================

DROP PROCEDURE IF EXISTS _227_add_col;
DELIMITER $$
CREATE PROCEDURE _227_add_col(
  IN p_column VARCHAR(64),
  IN p_definition TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'week_off_preference'
       AND COLUMN_NAME = p_column
  ) THEN
    SET @sql = CONCAT('ALTER TABLE week_off_preference ADD COLUMN `', p_column, '` ', p_definition);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$
DELIMITER ;

CALL _227_add_col('week_start_date', 'DATE NULL COMMENT ''Roster week this preference applies to (NULL = standing preference)'' AFTER employee_id');
CALL _227_add_col('process_id', 'VARCHAR(36) NULL COMMENT ''FK process_master.id - denormalised for fast WFM queries'' AFTER week_start_date');
CALL _227_add_col('branch_id', 'VARCHAR(36) NULL COMMENT ''FK branch_master.id'' AFTER process_id');
CALL _227_add_col('preferred_day_1', 'INT NULL COMMENT ''0=Sun..6=Sat - mirrors preferred_day; used by governance routes'' AFTER preferred_day');
CALL _227_add_col('preferred_day_2', 'INT NULL COMMENT ''Alternate day - mirrors alternate_day; used by governance routes'' AFTER preferred_day_1');
CALL _227_add_col('reason', 'TEXT NULL COMMENT ''Employee-provided reason for this preference'' AFTER preferred_day_2');
CALL _227_add_col('status', 'ENUM(''submitted'',''accepted'',''applied'',''rejected'',''waitlisted'') NOT NULL DEFAULT ''submitted'' COMMENT ''Governance lifecycle status - replaces binary approved flag'' AFTER approved');
CALL _227_add_col('manager_remarks', 'TEXT NULL COMMENT ''WFM/manager review notes'' AFTER status');
CALL _227_add_col('reviewed_at', 'DATETIME NULL COMMENT ''When WFM/manager acted on this preference'' AFTER manager_remarks');
CALL _227_add_col('created_by', 'VARCHAR(36) NULL COMMENT ''auth_user.id who submitted (for bulk import)'' AFTER reviewed_at');

DROP PROCEDURE IF EXISTS _227_add_col;

-- Sync preferred_day_1 / preferred_day_2 from old columns for existing rows
-- so old data is immediately visible under the new column names.
UPDATE week_off_preference
   SET preferred_day_1 = preferred_day,
       preferred_day_2 = alternate_day
 WHERE preferred_day_1 IS NULL;

-- Sync status from old approved flag for existing rows
UPDATE week_off_preference
   SET status = CASE WHEN approved = 1 THEN 'accepted' ELSE 'submitted' END
 WHERE status = 'submitted' AND approved IS NOT NULL;

-- Useful indexes for the new columns
SET @idx_exists = (
  SELECT COUNT(1)
    FROM information_schema.statistics
   WHERE table_schema = DATABASE()
     AND table_name = 'week_off_preference'
     AND index_name = 'idx_wop_process_week'
);
SET @sql = IF(@idx_exists = 0,
  'ALTER TABLE week_off_preference ADD INDEX idx_wop_process_week (process_id, week_start_date)',
  'SELECT ''idx_wop_process_week already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists = (
  SELECT COUNT(1)
    FROM information_schema.statistics
   WHERE table_schema = DATABASE()
     AND table_name = 'week_off_preference'
     AND index_name = 'idx_wop_status'
);
SET @sql = IF(@idx_exists = 0,
  'ALTER TABLE week_off_preference ADD INDEX idx_wop_status (status)',
  'SELECT ''idx_wop_status already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT '227_week_off_preference_schema_fix.sql applied successfully' AS migration_status;
