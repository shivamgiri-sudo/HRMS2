-- Additive migration: capture lat/lng at point of leave request submission
ALTER TABLE leave_request
  ADD COLUMN IF NOT EXISTS latitude  DECIMAL(10,8) NULL COMMENT 'Latitude at submission',
  ADD COLUMN IF NOT EXISTS longitude DECIMAL(11,8) NULL COMMENT 'Longitude at submission';
