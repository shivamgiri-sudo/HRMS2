-- Migration 413: Add is_billable and sub_source columns to employees
-- Required for Attendance Register, Salary Sheet, Left/New Join exports
ALTER TABLE employees
  ADD COLUMN is_billable TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'Whether employee is billable to client (1=Yes, 0=No)',
  ADD COLUMN sub_source VARCHAR(100) NULL COMMENT 'Recruitment sub-source (e.g. Walk-in, Referral, Portal name)';
