-- Migration 341: Add missing columns to candidate_onboarding_profile
-- Fixes HTTP 500 errors found during E2E test:
--   "Unknown column 'alt_mobile_number' in 'field list'"  (employee-details endpoint)
--   "Unknown column 'submit_lat' in 'field list'"          (submit endpoint)
--
-- Migration 323 added submit_lat/submit_lng but may not have run on all environments.
-- Migration 309 added many profile columns but missed alt_mobile_number.
-- This migration is additive and idempotent (ADD COLUMN IF NOT EXISTS).

USE mas_hrms;

ALTER TABLE candidate_onboarding_profile
  ADD COLUMN IF NOT EXISTS alt_mobile_number  VARCHAR(15)   NULL COMMENT 'Alternate / secondary mobile number',
  ADD COLUMN IF NOT EXISTS submit_lat         DECIMAL(10,8) NULL COMMENT 'Latitude captured at final form submission',
  ADD COLUMN IF NOT EXISTS submit_lng         DECIMAL(11,8) NULL COMMENT 'Longitude captured at final form submission';
