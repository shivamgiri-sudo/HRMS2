-- 172_employee_photo.sql
-- Ensures avatar_url column exists in employees table
-- and creates the upload tracking table

DROP PROCEDURE IF EXISTS _add_employee_photo_cols;
DELIMITER $$
CREATE PROCEDURE _add_employee_photo_cols()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'employees'
      AND COLUMN_NAME  = 'avatar_url'
  ) THEN
    ALTER TABLE employees
      ADD COLUMN avatar_url VARCHAR(512) NULL COMMENT 'Relative path: /uploads/employee-photos/<id>.<ext>';
  END IF;
END$$
DELIMITER ;
CALL _add_employee_photo_cols();
DROP PROCEDURE IF EXISTS _add_employee_photo_cols;
