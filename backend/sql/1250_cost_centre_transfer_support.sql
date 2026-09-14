-- 1250_cost_centre_transfer_support.sql
-- Adds cost_centre to transfer_type ENUM and new_reporting_manager_id for compound CC+RM transfers.
--
-- The reporting manager transfer bug (code checks 'reporting_manager' but ENUM has 'reporting')
-- is fixed by handling BOTH values in the service code rather than modifying the ENUM, since
-- there may be existing 'reporting' records in production.
--
-- Rollback:
--   ALTER TABLE transfer_record DROP COLUMN new_reporting_manager_id;
--   ALTER TABLE transfer_record MODIFY transfer_type ENUM('branch','department','process','location','reporting') NOT NULL DEFAULT 'department';

USE mas_hrms;

-- Step 1: Add cost_centre to the ENUM
ALTER TABLE transfer_record
  MODIFY COLUMN transfer_type
    ENUM('branch','department','process','location','reporting','cost_centre')
    NOT NULL DEFAULT 'department';

-- Step 2: Add new_reporting_manager_id for compound cost_centre + RM transfers
-- Only populated when transfer_type='cost_centre'
SET @col = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'transfer_record'
    AND COLUMN_NAME = 'new_reporting_manager_id'
);
SET @sql = IF(@col = 0,
  'ALTER TABLE transfer_record ADD COLUMN new_reporting_manager_id CHAR(36) NULL AFTER to_value',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Step 3: Add index
SET @idx = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'transfer_record'
    AND INDEX_NAME = 'idx_transfer_new_rm'
);
SET @sql = IF(@idx = 0,
  'ALTER TABLE transfer_record ADD INDEX idx_transfer_new_rm (new_reporting_manager_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
