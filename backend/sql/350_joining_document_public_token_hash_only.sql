-- =============================================================================
-- Migration 350: Make joining-document public tokens hash-only where possible
-- Scope: allow public_token to be nullable so new records store only the hash.
-- Idempotent and rerunnable: checks column nullability via DATABASE().
-- =============================================================================

SET @public_token_is_nullable = (
  SELECT IS_NULLABLE
    FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'employee_joining_document_public_token'
     AND COLUMN_NAME = 'public_token'
   LIMIT 1
);

SET @sql = IF(
  @public_token_is_nullable IS NULL,
  'SELECT ''employee_joining_document_public_token.public_token missing'' AS note',
  IF(
    @public_token_is_nullable = 'YES',
    'SELECT ''employee_joining_document_public_token.public_token already nullable'' AS note',
    'ALTER TABLE employee_joining_document_public_token MODIFY COLUMN public_token VARCHAR(255) NULL'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
