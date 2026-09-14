-- =============================================================================
-- Migration 349: Joining document actor/upload enum alignment
-- Scope: Extend initial joining-document enums so employee/public-token flows
-- do not fail when audit rows and secure uploads are written at runtime.
-- Idempotent and rerunnable: checks column metadata before applying ALTERs.
-- =============================================================================

SET @audit_actor_type = (
  SELECT COLUMN_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'employee_joining_document_audit_log'
     AND COLUMN_NAME = 'actor_type'
   LIMIT 1
);

SET @audit_actor_has_employee = IFNULL(LOCATE('''employee''', @audit_actor_type), 0);
SET @audit_actor_has_public_token = IFNULL(LOCATE('''public_token''', @audit_actor_type), 0);
SET @audit_actor_has_payroll = IFNULL(LOCATE('''payroll''', @audit_actor_type), 0);

SET @sql = IF(
  @audit_actor_type IS NULL,
  'SELECT ''employee_joining_document_audit_log.actor_type missing'' AS note',
  IF(
    @audit_actor_has_employee > 0 AND @audit_actor_has_public_token > 0 AND @audit_actor_has_payroll > 0,
    'SELECT ''employee_joining_document_audit_log.actor_type already aligned'' AS note',
    'ALTER TABLE employee_joining_document_audit_log MODIFY COLUMN actor_type ENUM(''hr'',''candidate'',''employee'',''payroll'',''public_token'',''system'') NOT NULL DEFAULT ''system'''
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @uploaded_by_type = (
  SELECT COLUMN_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'employee_joining_document_file'
     AND COLUMN_NAME = 'uploaded_by_type'
   LIMIT 1
);

SET @uploaded_by_has_employee = IFNULL(LOCATE('''employee''', @uploaded_by_type), 0);

SET @sql = IF(
  @uploaded_by_type IS NULL,
  'SELECT ''employee_joining_document_file.uploaded_by_type missing'' AS note',
  IF(
    @uploaded_by_has_employee > 0,
    'SELECT ''employee_joining_document_file.uploaded_by_type already aligned'' AS note',
    'ALTER TABLE employee_joining_document_file MODIFY COLUMN uploaded_by_type ENUM(''hr'',''candidate'',''employee'',''system'') NOT NULL DEFAULT ''hr'''
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @public_token_hash_exists = (
  SELECT COUNT(*)
    FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'employee_joining_document_public_token'
     AND COLUMN_NAME = 'public_token_hash'
);

SET @sql = IF(
  @public_token_hash_exists > 0,
  'SELECT ''employee_joining_document_public_token.public_token_hash already exists'' AS note',
  'ALTER TABLE employee_joining_document_public_token ADD COLUMN public_token_hash VARCHAR(64) NOT NULL AFTER public_token, ADD UNIQUE KEY uq_ejdpt_token_hash (public_token_hash)'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
