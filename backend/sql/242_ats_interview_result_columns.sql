-- Migration 242: Add missing columns to ats_interview_result
-- documents_pending, joining_interest, expected_joining_date, recruiter_recommendation

DELIMITER $$

DROP PROCEDURE IF EXISTS _add_interview_result_cols $$
CREATE PROCEDURE _add_interview_result_cols()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_interview_result' AND COLUMN_NAME = 'documents_pending'
  ) THEN
    ALTER TABLE ats_interview_result
      ADD COLUMN documents_pending        TINYINT(1)   NOT NULL DEFAULT 0 AFTER next_step,
      ADD COLUMN joining_interest         TINYINT(1)   NOT NULL DEFAULT 0 AFTER documents_pending,
      ADD COLUMN expected_joining_date    DATE         NULL AFTER joining_interest,
      ADD COLUMN recruiter_recommendation VARCHAR(500) NULL AFTER expected_joining_date;
  END IF;
END$$
CALL _add_interview_result_cols() $$
DROP PROCEDURE IF EXISTS _add_interview_result_cols $$

DELIMITER ;
