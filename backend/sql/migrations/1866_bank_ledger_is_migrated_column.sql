-- Add is_migrated column to bank_account_ledger_entry
-- Required for bank ledger migration from db_bill

ALTER TABLE bank_account_ledger_entry
ADD COLUMN is_migrated TINYINT(1) NOT NULL DEFAULT 0
COMMENT 'Set to 1 for entries migrated from db_bill'
AFTER source_type;

-- Index for filtering migrated vs native entries
CREATE INDEX idx_bale_migrated ON bank_account_ledger_entry(is_migrated);
