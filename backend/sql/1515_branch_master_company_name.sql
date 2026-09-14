-- 1515_branch_master_company_name.sql
-- Adds company_name to branch_master so GST export and reporting can identify
-- which legal entity (MAS, IDC, Pikquick) a branch belongs to without a
-- separate join to cost_centre_master or finance_company.
-- Nullable; backfill is a data-ops task after Finance confirms the mapping.
-- ADD COLUMN IF NOT EXISTS via information_schema guard (MySQL 8 safety).

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'branch_master'
    AND COLUMN_NAME  = 'company_name'
);

SET @sql = IF(@col_exists = 0,
  'ALTER TABLE branch_master ADD COLUMN company_name VARCHAR(255) NULL AFTER gst_state_code',
  'SELECT 1 -- already exists'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT 'Migration 1515 applied: branch_master.company_name ready' AS status;
