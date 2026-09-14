-- Migration 392: Add hr_contact column to branch_master
-- Used for auto-populating HR helpdesk info on employee ID cards.
-- Additive only — safe to run on existing schema.

SET @col_exists = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'branch_master'
     AND COLUMN_NAME  = 'hr_contact'
);
SET @ddl = IF(@col_exists = 0,
  'ALTER TABLE branch_master ADD COLUMN hr_contact VARCHAR(255) NULL COMMENT ''HR helpdesk email or phone for this branch'' AFTER address',
  'SELECT 1'
);
PREPARE _stmt FROM @ddl;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;
