-- 1835_meta_campaign_screening_config.sql
--
-- Campaign-level shortlisting criteria for META campaigns that have NO job requisition yet
-- ("JR pending"). The screener normally reads its criteria from the linked requisition; a campaign
-- without one had nowhere to hold rules, so its leads either qualified unchecked or stayed pending.
--
-- screening_config uses the same JSON shape as job_requisition.meta_screening_config
-- (certifications, custom_field_rules, auto_notify, ...). It is consulted ONLY while the campaign
-- has no requisition; once a requisition is linked, the requisition's criteria take over.
--
-- Additive and nullable: existing rows are unaffected. MySQL 8 has no ADD COLUMN IF NOT EXISTS, so
-- this uses the information_schema-guarded PREPARE/EXECUTE idiom.

SET @db = DATABASE();

SET @sql = IF(
  NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'meta_campaign'
                AND COLUMN_NAME = 'screening_config'),
  'ALTER TABLE meta_campaign ADD COLUMN screening_config JSON NULL',
  'SELECT ''screening_config already exists'' AS _skip'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
