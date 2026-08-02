-- Additive migration: capture lat/lng at point of onboarding final submission
ALTER TABLE candidate_onboarding_profile
  ADD COLUMN submit_lat DECIMAL(10,8) NULL COMMENT 'Latitude at submit',
  ADD COLUMN submit_lng DECIMAL(11,8) NULL COMMENT 'Longitude at submit';
