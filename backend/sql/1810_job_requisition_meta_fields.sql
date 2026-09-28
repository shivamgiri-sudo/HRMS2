-- Migration 1810: META campaign targeting fields on job_requisition.
--
-- Five additive columns, consumed by the marketing campaign brief email (Package B) and by the
-- lead screener (Package C), which compares an incoming lead's age against the requisition's
-- own target band rather than a global constant.
--
--   bmi_assessment_url     The assessment link the marketing team embeds in the Lead Gen ad.
--                          Named for the owner's term ("BMI link"); unrelated to the existing
--                          BMI benchmark board.
--   meta_target_age_min/max Candidate age band for META audience targeting AND for screening.
--   meta_target_locations  JSON array of city/area names for geo-targeting.
--   meta_target_radius_km  Radius around each location.
--
-- Idempotency: the plan used a bare multi-column `ALTER TABLE ... ADD COLUMN ... AFTER`, which
-- throws ER_DUP_FIELDNAME on a second run. Every migration here must be re-runnable (the runner
-- retries on transient lock errors and re-applies on checksum change), so each column is guarded
-- through INFORMATION_SCHEMA, following the pattern established by 1804. `ADD COLUMN IF NOT
-- EXISTS` (as used by 538) is deliberately avoided: it is MariaDB syntax and is a hard parse
-- error on MySQL 8.

USE mas_hrms;

SET @tbl := 'job_requisition';

SET @col := 'bmi_assessment_url';
SET @sql := (SELECT IF(COUNT(*) = 0,
  CONCAT('ALTER TABLE `', @tbl, '` ADD COLUMN bmi_assessment_url VARCHAR(500) NULL COMMENT ''Assessment/BMI link embedded in the META campaign ad'' AFTER job_description'),
  'SELECT 1')
  FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := 'meta_target_age_min';
SET @sql := (SELECT IF(COUNT(*) = 0,
  CONCAT('ALTER TABLE `', @tbl, '` ADD COLUMN meta_target_age_min TINYINT UNSIGNED NULL COMMENT ''Minimum candidate age - META targeting and lead screening'''),
  'SELECT 1')
  FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := 'meta_target_age_max';
SET @sql := (SELECT IF(COUNT(*) = 0,
  CONCAT('ALTER TABLE `', @tbl, '` ADD COLUMN meta_target_age_max TINYINT UNSIGNED NULL COMMENT ''Maximum candidate age - META targeting and lead screening'''),
  'SELECT 1')
  FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := 'meta_target_locations';
SET @sql := (SELECT IF(COUNT(*) = 0,
  CONCAT('ALTER TABLE `', @tbl, '` ADD COLUMN meta_target_locations JSON NULL COMMENT ''Array of city/area strings for geo-targeting, e.g. ["Mumbai","Thane"]'''),
  'SELECT 1')
  FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := 'meta_target_radius_km';
SET @sql := (SELECT IF(COUNT(*) = 0,
  CONCAT('ALTER TABLE `', @tbl, '` ADD COLUMN meta_target_radius_km SMALLINT UNSIGNED NULL DEFAULT 25 COMMENT ''Radius in km around each target location'''),
  'SELECT 1')
  FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = @tbl AND COLUMN_NAME = @col);
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SELECT 'Migration 1810 applied: job_requisition META targeting + BMI URL columns' AS status;
