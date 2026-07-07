-- Migration 364: Add substitute interviewer tracking to ats_interview_submission
-- Allows a recruiter to conduct an interview on behalf of an absent assigned recruiter

ALTER TABLE ats_interview_submission
  ADD COLUMN IF NOT EXISTS substitute_interviewer_id CHAR(36) NULL COMMENT 'Recruiter who conducted interview in place of assigned recruiter',
  ADD COLUMN IF NOT EXISTS substitute_reason VARCHAR(500) NULL COMMENT 'Reason given when conducting as substitute';
