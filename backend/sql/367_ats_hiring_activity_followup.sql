-- Migration 367: Add followup columns to ats_recruiter_hiring_activity
-- Safe conditional approach for MySQL 8.0

DROP PROCEDURE IF EXISTS _add_followup_columns;

DELIMITER $$
CREATE PROCEDURE _add_followup_columns()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ats_recruiter_hiring_activity'
      AND COLUMN_NAME = 'followup_required'
  ) THEN
    ALTER TABLE ats_recruiter_hiring_activity
      ADD COLUMN followup_required TINYINT(1) NOT NULL DEFAULT 0,
      ADD COLUMN followup_date     DATE          NULL,
      ADD COLUMN followup_reason   TEXT          NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ats_recruiter_hiring_activity'
      AND INDEX_NAME = 'idx_arha_followup'
  ) THEN
    ALTER TABLE ats_recruiter_hiring_activity
      ADD INDEX idx_arha_followup (followup_required, followup_date);
  END IF;
END$$
DELIMITER ;

CALL _add_followup_columns();
DROP PROCEDURE IF EXISTS _add_followup_columns;
