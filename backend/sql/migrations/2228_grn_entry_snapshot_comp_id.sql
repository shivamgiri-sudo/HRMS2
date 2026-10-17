-- Migration: 2228_grn_entry_snapshot_comp_id.sql
-- Purpose: record db_bill's company (expense_entry_master.CompId) on every mirrored GRN so the
--          P&L can keep only MAS Callnet India Pvt Ltd (CompId=1) spend.
-- Date: 2026-10-17
-- Why a column and not a sync filter: the sync prunes snapshot rows it no longer sees, so
--          filtering IDC (CompId=2) out at sync time would DELETE ~4k rows. A column keeps the
--          mirror complete and lets each reader decide. Some IDC rows carry no GrnNo, so the
--          'IDC/%' prefix alone cannot identify them (72 such rows in FY26-27, ~22L).
-- Additive: NULL until the next sync fills it. Revert: ALTER TABLE grn_entry_snapshot DROP COLUMN comp_id.

SET @col_exists = (
  SELECT COUNT(*)
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'grn_entry_snapshot'
     AND COLUMN_NAME = 'comp_id'
);

SET @sql = IF(@col_exists = 0,
  'ALTER TABLE grn_entry_snapshot ADD COLUMN comp_id INT NULL',
  'SELECT ''comp_id already exists on grn_entry_snapshot'' AS message'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
