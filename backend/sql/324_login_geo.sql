-- Additive migration: capture lat/lng at login event
-- Stores last known login location alongside last_login_at on auth_user
ALTER TABLE auth_user
  ADD COLUMN IF NOT EXISTS last_login_lat DECIMAL(10,8) NULL COMMENT 'Latitude at last login',
  ADD COLUMN IF NOT EXISTS last_login_lng DECIMAL(11,8) NULL COMMENT 'Longitude at last login';
