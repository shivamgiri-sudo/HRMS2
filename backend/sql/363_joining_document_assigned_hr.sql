-- Add assigned_hr_user_id column for HR task assignment tracking
-- Purpose: Track which HR person is responsible for each employee's document checklist
-- Used by: Bulk Assign HR action + "Assigned HR" column in tracker table

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'employee_joining_document_checklist'
      AND COLUMN_NAME = 'assigned_hr_user_id') = 0,
  'ALTER TABLE employee_joining_document_checklist
     ADD COLUMN assigned_hr_user_id CHAR(36) NULL AFTER verified_at,
     ADD INDEX idx_ejdc_assigned_hr (assigned_hr_user_id)',
  'SELECT ''employee_joining_document_checklist.assigned_hr_user_id already exists'' AS note'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
