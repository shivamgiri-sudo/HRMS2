-- Add description column to department_master — matches the UI form field
ALTER TABLE department_master
  ADD COLUMN IF NOT EXISTS description VARCHAR(500) NULL AFTER dept_name;
