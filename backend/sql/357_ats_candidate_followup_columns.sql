-- Adds candidate-level follow-up fields used by recruiter feedback updates.
-- Migration 345 added the same fields to ats_interview_submission; this keeps
-- ats_candidate in parity for live databases that predate the feedback rewrite.

SET @candidate_followup_required_sql = IF(
  (SELECT COUNT(*)
     FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ats_candidate'
      AND COLUMN_NAME = 'followup_required') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN followup_required TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT ''ats_candidate.followup_required already exists'' AS note'
);
PREPARE stmt FROM @candidate_followup_required_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @candidate_followup_date_sql = IF(
  (SELECT COUNT(*)
     FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ats_candidate'
      AND COLUMN_NAME = 'followup_date') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN followup_date DATE NULL',
  'SELECT ''ats_candidate.followup_date already exists'' AS note'
);
PREPARE stmt FROM @candidate_followup_date_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @candidate_followup_reason_sql = IF(
  (SELECT COUNT(*)
     FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ats_candidate'
      AND COLUMN_NAME = 'followup_reason') = 0,
  'ALTER TABLE ats_candidate ADD COLUMN followup_reason TEXT NULL',
  'SELECT ''ats_candidate.followup_reason already exists'' AS note'
);
PREPARE stmt FROM @candidate_followup_reason_sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

