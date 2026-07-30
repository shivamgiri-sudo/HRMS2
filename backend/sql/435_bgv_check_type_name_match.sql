-- 435_bgv_check_type_name_match.sql
-- candidate_bgv_check.check_type is an ENUM that never included 'name_match',
-- yet runNameMatchCheck() (bgv-verification.service.ts) has always inserted
-- rows with check_type='name_match' — every call fails with "Data truncated
-- for column 'check_type'". Discovered via a real Playwright E2E run against
-- POST /api/ats/bgv/trigger/:candidateId. Since submitFullOnboarding() also
-- fires this same path as fire-and-forget, name-match BGV has silently never
-- recorded for any real candidate either.

SET @has_name_match = (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'candidate_bgv_check'
     AND column_name = 'check_type'
     AND FIND_IN_SET('name_match', REPLACE(REPLACE(REPLACE(column_type, 'enum(', ''), ')', ''), '''', '')) > 0
);
SET @sql = IF(
  @has_name_match = 0,
  "ALTER TABLE candidate_bgv_check MODIFY COLUMN check_type ENUM('pan','aadhaar','aadhaar_offline','bank','digilocker','employment','education','address','criminal','court','address_doc','education_doc','photo_match','name_match') NOT NULL",
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SELECT '435_bgv_check_type_name_match.sql applied' AS migration_status;
