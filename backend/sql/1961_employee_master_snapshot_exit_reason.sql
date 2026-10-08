-- Migration 1961: employee_master_snapshot -- add exit_reason column
--
-- Employee Master report: status column now shows only "Active" or "Left". A new
-- exit_reason column carries the employment_status text for inactive employees
-- (resigned / absconded / terminated / etc.) so voluntary vs involuntary attrition
-- is visible in a dedicated column rather than mixed into Status.
--
-- Purely additive. Idempotent via INFORMATION_SCHEMA guard.

SET @tbl = 'employee_master_snapshot';

SET @sql = (SELECT IF(COUNT(*)=0,
  CONCAT('ALTER TABLE `',@tbl,'` ADD COLUMN exit_reason TEXT NULL COMMENT ''Employment status detail for inactive employees (resigned/absconded/terminated etc); NULL for active'''),
  'SELECT 1') FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=@tbl AND COLUMN_NAME='exit_reason');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
