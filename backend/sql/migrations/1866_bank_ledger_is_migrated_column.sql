-- Add is_migrated column to bank_account_ledger_entry
-- Required for bank ledger migration from db_bill
-- information_schema-guarded so idempotent on re-run (column already exists on production)

SET @dbname = DATABASE();
SET @tblname = 'bank_account_ledger_entry';
SET @colname = 'is_migrated';

SET @sql = (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tblname AND COLUMN_NAME = @colname
    ),
    'SELECT 1',
    CONCAT('ALTER TABLE `', @tblname, '` ADD COLUMN `', @colname, '` TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''Set to 1 for entries migrated from db_bill'' AFTER source_type')
  )
);
PREPARE __stmt FROM @sql; EXECUTE __stmt; DEALLOCATE PREPARE __stmt;

SET @idxname = 'idx_bale_migrated';
SET @sql2 = (
  SELECT IF(
    EXISTS (
      SELECT 1 FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tblname AND INDEX_NAME = @idxname
    ),
    'SELECT 1',
    CONCAT('CREATE INDEX `', @idxname, '` ON `', @tblname, '`(is_migrated)')
  )
);
PREPARE __stmt2 FROM @sql2; EXECUTE __stmt2; DEALLOCATE PREPARE __stmt2;
