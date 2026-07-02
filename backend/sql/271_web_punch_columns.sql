-- Migration 271: Add web punch-in/out columns to attendance_daily_record
-- Web punch is validation-only. It does NOT affect attendance_status classification.
-- Stored separately so canonical clock_in_time/clock_out_time (biometric/payroll) are never overwritten.

ALTER TABLE attendance_daily_record
  ADD COLUMN IF NOT EXISTS web_punch_in  DATETIME NULL DEFAULT NULL AFTER clock_out_location,
  ADD COLUMN IF NOT EXISTS web_punch_out DATETIME NULL DEFAULT NULL AFTER web_punch_in,
  ADD COLUMN IF NOT EXISTS web_punch_in_lat  DECIMAL(10,7) NULL DEFAULT NULL AFTER web_punch_out,
  ADD COLUMN IF NOT EXISTS web_punch_in_lng  DECIMAL(10,7) NULL DEFAULT NULL AFTER web_punch_in_lat,
  ADD COLUMN IF NOT EXISTS web_punch_out_lat DECIMAL(10,7) NULL DEFAULT NULL AFTER web_punch_in_lng,
  ADD COLUMN IF NOT EXISTS web_punch_out_lng DECIMAL(10,7) NULL DEFAULT NULL AFTER web_punch_out_lat,
  ADD COLUMN IF NOT EXISTS web_punch_location VARCHAR(255) NULL DEFAULT NULL AFTER web_punch_out_lng;
