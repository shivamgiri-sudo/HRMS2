-- Migration 364: Add substitute interviewer tracking to ats_interview_submission
-- Allows a recruiter to conduct an interview on behalf of an absent assigned recruiter
--
-- FIXED 2026-08-14: `ADD COLUMN IF NOT EXISTS` is MariaDB syntax, rejected by this production
-- MySQL 8.0.42 build with ER_PARSE_ERROR — same class as the 1006 outage
-- (docs/incidents/2026-08-13-migration-1006-production-outage.md). Both columns already exist
-- on production (confirmed via information_schema before this fix), so this is a no-op guard
-- rewrite.
SET @c1 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_interview_submission' AND COLUMN_NAME = 'substitute_interviewer_id');
SET @sql = IF(@c1 = 0,
  'ALTER TABLE ats_interview_submission ADD COLUMN substitute_interviewer_id CHAR(36) NULL COMMENT ''Recruiter who conducted interview in place of assigned recruiter''',
  'SELECT "substitute_interviewer_id already exists" AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @c2 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ats_interview_submission' AND COLUMN_NAME = 'substitute_reason');
SET @sql = IF(@c2 = 0,
  'ALTER TABLE ats_interview_submission ADD COLUMN substitute_reason VARCHAR(500) NULL COMMENT ''Reason given when conducting as substitute''',
  'SELECT "substitute_reason already exists" AS info'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
