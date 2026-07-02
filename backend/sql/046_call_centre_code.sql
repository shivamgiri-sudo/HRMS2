USE mas_hrms;

-- Add call_centre_code to branch_master (nullable first, backfill, then NOT NULL)
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='branch_master' AND COLUMN_NAME='call_centre_code');
SET @sql = IF(@col = 0,
  "ALTER TABLE branch_master ADD COLUMN call_centre_code VARCHAR(30) NULL COMMENT 'Master key: unique CC identifier used across reports and integrations', ADD UNIQUE INDEX ux_branch_cc_code (call_centre_code)",
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Backfill from branch_code
UPDATE branch_master SET call_centre_code = branch_code WHERE call_centre_code IS NULL;

-- Add call_centre_code to process_master (nullable FK-style reference)
SET @col2 = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='process_master' AND COLUMN_NAME='call_centre_code');
SET @sql2 = IF(@col2 = 0,
  "ALTER TABLE process_master ADD COLUMN call_centre_code VARCHAR(30) NULL COMMENT 'Inherited from branch; overridable for reporting'",
  'SELECT 1');
PREPARE s2 FROM @sql2; EXECUTE s2; DEALLOCATE PREPARE s2;

-- Add call_centre_code to employees (denormalized for fast report joins)
SET @col3 = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='mas_hrms' AND TABLE_NAME='employees' AND COLUMN_NAME='call_centre_code');
SET @sql3 = IF(@col3 = 0,
  "ALTER TABLE employees ADD COLUMN call_centre_code VARCHAR(30) NULL COMMENT 'Denormalized from branch; updated on branch assignment'",
  'SELECT 1');
PREPARE s3 FROM @sql3; EXECUTE s3; DEALLOCATE PREPARE s3;

SELECT 'Migration 046 applied: call_centre_code added to branch_master, process_master, employees' AS status;
