-- 1037_lms_employee_mapping_missing_columns.sql
--
-- Fixes a LIVE production error: every LMS learner mapping fails to save.
--
-- SYMPTOM (production workers log, 2026-08-01 09:35:07, one line per assessment):
--     assessment mas62672: Unknown column 'mapping_source' in 'field list'
--     assessment mas58505: Unknown column 'mapping_source' in 'field list'
--     ... and 17 more errors
--
-- CAUSE
-- lms-employee-mapper.ts:49 (modules/lms/, the one lms.sync.service.ts actually imports)
-- inserts into lms_employee_mapping with columns the table has never had:
--
--     table has  : id, employee_id, lms_learner_id, email, mapped_at, is_active
--     code writes: ... + mapping_source, mapping_confidence, hrms_employee_code, mapped_by
--
-- So the INSERT throws for every learner. The sync catches it per-assessment and keeps
-- going, which is why assessment rows still land (67 of them) while mapping silently never
-- updates. The 265 rows already in the table predate this code path.
--
-- WHY ADD COLUMNS RATHER THAN STRIP THE CODE
-- The four fields are the mapper's audit trail: which identifier matched (mobile / personal
-- email / official email / employee code / manual) and how confident that match was. The
-- module has MappingSource and MappingConfidence types built around them, and
-- lms_mapping_audit already records the same information per attempt. The table is simply
-- missing a migration, not carrying a wrong design.
--
-- NOTE — a second, dead mapper exists at modules/lms-integration/lms-employee-mapper.ts. It
-- writes NINE columns this table does not have (lms_employee_id, hrms_employee_id,
-- hrms_mobile, ...) and is imported by nothing, so it could never have run. It is left
-- untouched deliberately (CLAUDE.md rule 3) and is NOT what this migration targets — do not
-- "fix" the table to satisfy it, that would be designing for dead code.
--
-- ON DUPLICATE KEY works here: uq_lms_emp is UNIQUE on employee_id. Verified, unlike the
-- LMS snapshot tables in 1030 where the same clause was dead code.
--
-- ADDITIVE and idempotent. All four columns are NULLable, so the 265 existing rows are
-- untouched and nothing needs backfilling. Rollback is the commented ALTER at the foot.

SET NAMES utf8mb4;
SET @db := DATABASE();

-- Guarded so re-running is safe; MySQL has no ADD COLUMN IF NOT EXISTS before 8.0.
SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=@db AND TABLE_NAME='lms_employee_mapping' AND COLUMN_NAME='mapping_source') = 0,
  "ALTER TABLE lms_employee_mapping
     ADD COLUMN mapping_source ENUM('mobile','personal_email','official_email','employee_code','manual')
       NULL COMMENT 'Which identifier matched this learner to an employee'",
  'SELECT ''mapping_source exists'''));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=@db AND TABLE_NAME='lms_employee_mapping' AND COLUMN_NAME='mapping_confidence') = 0,
  "ALTER TABLE lms_employee_mapping
     ADD COLUMN mapping_confidence ENUM('high','medium','low')
       NULL COMMENT 'Confidence of the identifier match'",
  'SELECT ''mapping_confidence exists'''));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=@db AND TABLE_NAME='lms_employee_mapping' AND COLUMN_NAME='hrms_employee_code') = 0,
  "ALTER TABLE lms_employee_mapping
     ADD COLUMN hrms_employee_code VARCHAR(64)
       NULL COMMENT 'Denormalised employee_code at mapping time, for audit'",
  'SELECT ''hrms_employee_code exists'''));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=@db AND TABLE_NAME='lms_employee_mapping' AND COLUMN_NAME='mapped_by') = 0,
  "ALTER TABLE lms_employee_mapping
     ADD COLUMN mapped_by VARCHAR(64) NULL DEFAULT 'system'
       COMMENT 'system for worker-made mappings, else the actor who mapped manually'",
  'SELECT ''mapped_by exists'''));
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
-- All four present (expect 4):
--   SELECT COUNT(*) FROM information_schema.COLUMNS
--    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='lms_employee_mapping'
--      AND COLUMN_NAME IN ('mapping_source','mapping_confidence','hrms_employee_code','mapped_by');
--
-- Existing rows untouched (expect 265, all four NULL):
--   SELECT COUNT(*) total, COUNT(mapping_source) with_source FROM lms_employee_mapping;
--
-- The real proof is the workers log going quiet on the next lms-sync run:
--   pm2 logs hrms2-workers --err --lines 50 --nostream | grep mapping_source
--
-- ---------------------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------------------
-- ALTER TABLE lms_employee_mapping
--   DROP COLUMN mapping_source, DROP COLUMN mapping_confidence,
--   DROP COLUMN hrms_employee_code, DROP COLUMN mapped_by;
