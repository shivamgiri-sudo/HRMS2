-- Migration 101: Add enrichment columns to APR table
-- Adds employee name, process, branch, reporting manager, cost centre
-- These are synced from mas_hrms.employees when APR data is upserted

ALTER TABLE apr
  ADD COLUMN employee_name   VARCHAR(200)  NULL AFTER campaign_id,
  ADD COLUMN process_name    VARCHAR(200)  NULL AFTER employee_name,
  ADD COLUMN branch_name     VARCHAR(200)  NULL AFTER process_name,
  ADD COLUMN reporting_manager VARCHAR(200) NULL AFTER branch_name,
  ADD COLUMN cost_centre     VARCHAR(200)  NULL AFTER reporting_manager;
