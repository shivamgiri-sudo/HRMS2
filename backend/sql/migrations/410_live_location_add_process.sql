-- Migration 410: Add process_name and designation to employee_live_location
-- Safe additive ALTER — both columns are nullable so existing rows are unaffected.

ALTER TABLE employee_live_location
  ADD COLUMN process_name VARCHAR(128) NULL AFTER branch_name,
  ADD COLUMN designation  VARCHAR(128) NULL AFTER process_name;
