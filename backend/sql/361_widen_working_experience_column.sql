-- Widen working_experience column to hold longer UI labels
ALTER TABLE candidate_onboarding_experience
  MODIFY COLUMN working_experience VARCHAR(50) NULL;
