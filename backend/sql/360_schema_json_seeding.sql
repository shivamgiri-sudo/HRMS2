-- Migration 360: Schema JSON seeding support for document templates
-- Additive only — no existing columns or data modified

DROP PROCEDURE IF EXISTS _migrate_360;
DELIMITER //
CREATE PROCEDURE _migrate_360()
BEGIN
  -- employee_joining_document_template: add template_schema_filename
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'employee_joining_document_template'
      AND COLUMN_NAME  = 'template_schema_filename'
  ) THEN
    ALTER TABLE employee_joining_document_template
      ADD COLUMN template_schema_filename VARCHAR(255) NULL
        COMMENT 'Original filename of the uploaded field-map JSON schema'
        AFTER template_schema_json;
  END IF;

  -- document_template_field_map: add schema_field_tooltip
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'document_template_field_map'
      AND COLUMN_NAME  = 'schema_field_tooltip'
  ) THEN
    ALTER TABLE document_template_field_map
      ADD COLUMN schema_field_tooltip VARCHAR(500) NULL
        COMMENT 'Tooltip text extracted from the uploaded JSON schema (field.tooltip)'
        AFTER transform_rule;
  END IF;

  -- document_template_field_map: add schema_suggested_path
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'document_template_field_map'
      AND COLUMN_NAME  = 'schema_suggested_path'
  ) THEN
    ALTER TABLE document_template_field_map
      ADD COLUMN schema_suggested_path VARCHAR(300) NULL
        COMMENT 'Raw db_source_suggestion from the uploaded JSON schema, shown in the mapping UI'
        AFTER schema_field_tooltip;
  END IF;

  -- document_template_field_map: add mapping_confirmed
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'document_template_field_map'
      AND COLUMN_NAME  = 'mapping_confirmed'
  ) THEN
    ALTER TABLE document_template_field_map
      ADD COLUMN mapping_confirmed TINYINT(1) NOT NULL DEFAULT 0
        COMMENT '0 = auto-seeded (amber), 1 = admin confirmed (green). Confirmed rows are not overwritten on re-upload.'
        AFTER schema_suggested_path;
  END IF;
END //
DELIMITER ;

CALL _migrate_360();
DROP PROCEDURE IF EXISTS _migrate_360;
