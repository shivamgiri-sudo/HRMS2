-- Add 'aml' to candidate_bgv_check.check_type
--
-- WHY
-- ---
-- AML screening is queued after employee code generation for designations whose
-- BGV policy requires it (getBgvRequirementsByDesignation().aml). The result is
-- recorded like any other check, but check_type is an ENUM and does not list
-- 'aml', so the INSERT throws under MySQL STRICT mode.
--
-- Adding a value to an ENUM is additive: existing rows are untouched, and no
-- application reading this column has to change. Nothing else in the enum is
-- reordered or removed, because the stored values are the labels themselves.
--
-- Production runs SKIP_MIGRATIONS=true, so this is applied by hand. The code
-- works without it — queueAmlScreening catches the failure and logs that this
-- migration is outstanding rather than silently recording nothing.
--
-- Guarded so it is safe to run twice.

SET @has_aml := (
  SELECT COUNT(*)
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'candidate_bgv_check'
     AND COLUMN_NAME = 'check_type'
     AND COLUMN_TYPE LIKE '%''aml''%'
);

SET @sql := IF(
  @has_aml = 0,
  "ALTER TABLE candidate_bgv_check
     MODIFY COLUMN check_type ENUM(
       'pan','aadhaar','aadhaar_offline','bank','digilocker','employment',
       'education','address','criminal','court','address_doc','education_doc',
       'photo_match','name_match','aml'
     ) NOT NULL",
  "SELECT 'check_type already accepts aml — nothing to do' AS status"
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT '✓ 1060_bgv_check_type_aml.sql complete' AS status;
