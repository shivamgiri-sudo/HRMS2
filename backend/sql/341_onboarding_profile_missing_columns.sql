-- Migration 341: Add missing columns to candidate_onboarding_profile
-- Fixes HTTP 500 errors found during E2E test:
--   "Unknown column 'alt_mobile_number' in 'field list'"  (employee-details endpoint)
--   "Unknown column 'submit_lat' in 'field list'"          (submit endpoint)
--
-- Migration 323 added submit_lat/submit_lng but may not have run on all environments.
-- Migration 309 added many profile columns but missed alt_mobile_number.
-- This migration is additive and idempotent (ADD COLUMN IF NOT EXISTS).

USE mas_hrms;

SET @mcol_1 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_onboarding_profile' AND COLUMN_NAME = 'alt_mobile_number'
);
SET @msql_1 = IF(@mcol_1 = 0,
  'ALTER TABLE candidate_onboarding_profile ADD COLUMN alt_mobile_number  VARCHAR(15)   NULL COMMENT ''Alternate / secondary mobile number''',
  'SELECT "alt_mobile_number already exists" AS message');
PREPARE mstmt_1 FROM @msql_1;
EXECUTE mstmt_1;
DEALLOCATE PREPARE mstmt_1;

SET @mcol_2 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_onboarding_profile' AND COLUMN_NAME = 'submit_lat'
);
SET @msql_2 = IF(@mcol_2 = 0,
  'ALTER TABLE candidate_onboarding_profile ADD COLUMN submit_lat         DECIMAL(10,8) NULL COMMENT ''Latitude captured at final form submission''',
  'SELECT "submit_lat already exists" AS message');
PREPARE mstmt_2 FROM @msql_2;
EXECUTE mstmt_2;
DEALLOCATE PREPARE mstmt_2;

SET @mcol_3 = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'candidate_onboarding_profile' AND COLUMN_NAME = 'submit_lng'
);
SET @msql_3 = IF(@mcol_3 = 0,
  'ALTER TABLE candidate_onboarding_profile ADD COLUMN submit_lng         DECIMAL(11,8) NULL COMMENT ''Longitude captured at final form submission''',
  'SELECT "submit_lng already exists" AS message');
PREPARE mstmt_3 FROM @msql_3;
EXECUTE mstmt_3;
DEALLOCATE PREPARE mstmt_3;
