-- 1711_bank_reconciliation_ledger_columns.sql
--
-- Additive columns on bank_account_ledger_entry for Phase 4. Both nullable, default NULL — no
-- backfill needed, no existing read path is affected. Guarded with the information_schema
-- check this repo's migration rules require before any ALTER, so a second run is a no-op.
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'bank_account_ledger_entry'
     AND COLUMN_NAME = 'matched_statement_line_id'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE bank_account_ledger_entry
     ADD COLUMN matched_statement_line_id CHAR(36) NULL COMMENT ''Set when matched to a bank_statement_line during reconciliation.'' AFTER source_type,
     ADD COLUMN reconciliation_period_id CHAR(36) NULL COMMENT ''Set only when the covering bank_reconciliation_period is closed. Presence = locked.'' AFTER matched_statement_line_id,
     ADD INDEX idx_bale_matched_line (matched_statement_line_id),
     ADD INDEX idx_bale_recon_period (reconciliation_period_id)',
  'SELECT ''1711 columns already exist'' AS migration_status'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SELECT '1711_bank_reconciliation_ledger_columns.sql applied' AS migration_status;
