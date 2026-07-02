-- Migration 225: Add shift_rotation_type to employees table
-- frozen   = employee always gets the same shift (never auto-reassigned)
-- weekly   = shift rotates on a weekly basis per roster_template pattern
-- daily    = shift may change day-to-day per roster_template pattern
-- rotating = follows a rolling rotation cycle (e.g. 14-day or 28-day pattern)

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS shift_rotation_type
    ENUM('frozen', 'weekly', 'daily', 'rotating')
    NOT NULL DEFAULT 'frozen'
    COMMENT 'Controls how the auto-roster engine assigns shifts for this employee'
  AFTER designation;

-- Index for roster engine queries (frequently filtered by process + rotation type)
SET @dbname = DATABASE();
SET @tblname = 'employees';
SET @idxname = 'idx_emp_shift_rotation_type';
SET @cnt = (
  SELECT COUNT(1)
  FROM information_schema.statistics
  WHERE table_schema = @dbname
    AND table_name   = @tblname
    AND index_name   = @idxname
);
SET @sql = IF(@cnt = 0,
  CONCAT('ALTER TABLE `', @tblname, '` ADD INDEX `', @idxname, '` (shift_rotation_type)'),
  'SELECT ''idx already exists'' AS note'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Seed bulk_upload template for SHIFT_ROTATION_BULK so BulkUploadHub can show it
INSERT IGNORE INTO upload_template_master
  (id, upload_type_code, upload_type_name, target_table, description,
   required_columns, optional_columns, sample_row, active_status)
VALUES (
  UUID(),
  'SHIFT_ROTATION_TYPE_UPDATE',
  'Shift Rotation Type Bulk Update',
  'employees',
  'Bulk-set shift_rotation_type for existing employees. Valid values: frozen, weekly, daily, rotating.',
  JSON_ARRAY('employee_code', 'shift_rotation_type'),
  JSON_ARRAY(),
  JSON_OBJECT('employee_code', 'MAS00001', 'shift_rotation_type', 'frozen'),
  1
);

SELECT '225_employee_shift_rotation_type.sql applied successfully' AS migration_status;
