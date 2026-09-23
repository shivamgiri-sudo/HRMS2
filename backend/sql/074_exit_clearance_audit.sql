-- 074_exit_clearance_audit.sql
USE mas_hrms;

ALTER TABLE exit_clearance_task
  ADD COLUMN cleared_by_name   VARCHAR(140) NULL AFTER cleared_by,
  ADD COLUMN cleared_by_role   VARCHAR(80)  NULL AFTER cleared_by_name,
  ADD COLUMN clearing_reason   VARCHAR(700) NULL AFTER cleared_by_role;
