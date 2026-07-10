-- Add is_followup_attempt flag to hiring activity
-- When same mobile+process is logged again on the same day, it's a follow-up call not a unique attempt
ALTER TABLE ats_recruiter_hiring_activity
  ADD COLUMN IF NOT EXISTS is_followup_attempt TINYINT(1) NOT NULL DEFAULT 0 AFTER followup_reason,
  ADD COLUMN IF NOT EXISTS followup_of_activity_id CHAR(36) NULL AFTER is_followup_attempt;
