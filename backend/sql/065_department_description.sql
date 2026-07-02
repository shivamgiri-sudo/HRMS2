-- Add description column to department_master — matches the UI form field
-- NOTE: Migration runner handles "Duplicate column" errors as idempotent
ALTER TABLE department_master ADD COLUMN description VARCHAR(500) NULL AFTER dept_name;
