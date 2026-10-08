-- 2144: employee_master_snapshot.exit_reason (Employee Master report "Exit Reason" column).
-- Status in the report is now only "Active" / "Left"; exit_reason carries the employment_status
-- text (resigned / absconded / terminated / ...) for inactive employees, NULL for active ones.
-- Originally written as backend/sql/1961_employee_master_snapshot_exit_reason.sql in 701e5978b
-- (wrong folder, number 1961 already taken by 1961_bbb_upload_rules.sql, never registered).
-- Additive, re-runnable (information_schema-guarded ALTER).
SET @s = IF((SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'employee_master_snapshot' AND COLUMN_NAME = 'exit_reason') = 0, "ALTER TABLE employee_master_snapshot ADD COLUMN exit_reason TEXT NULL COMMENT 'employment_status text for inactive employees; NULL for active' AFTER status", 'SELECT 1'); PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;
