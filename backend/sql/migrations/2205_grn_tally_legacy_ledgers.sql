-- GRN Tally export: the legacy billing system's TDS and ledger settings, carried into HRMS (2026-10-14).
-- ADDITIVE ONLY. Every statement is guarded against re-run and against a missing table.
--   * finance_expense_sub_head_master.tds_enabled / tds_rate / tds_tally_ledger: db_bill keeps TDS on the
--     sub-head (tbl_bgt_expensesubheadingmaster.SubHeadTDSEnabled / SubHeadTds / SubHeadTdsSection ->
--     tds_master.description), and its GRN import books TDS from it: Office Rent -> "TDS RENT 2022-23" 10%,
--     Cafeteria -> "TDS CONTRACTOR 2021-22" 2% ... NULL = not known (the export then falls back).
--   * vendor_master.tds_tally_ledger: a vendor's own TDS ledger, used when its sub-head has none
--     (OESPL parking/electricity -> "TDS CONTRACTOR 2022-23-OESPL" 2.5%).
-- Values are filled by scripts/backfill-grn-tally-from-dbbill.ts (dry run by default). No row changes here.
-- Rollback: ALTER TABLE finance_expense_sub_head_master DROP COLUMN tds_enabled, DROP COLUMN tds_rate, DROP COLUMN tds_tally_ledger;
--           ALTER TABLE vendor_master DROP COLUMN tds_tally_ledger;

SET @add_sh_tds_enabled = (
  SELECT IF(COUNT(*) = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'finance_expense_sub_head_master') = 1,
    "ALTER TABLE finance_expense_sub_head_master ADD COLUMN tds_enabled TINYINT(1) NULL COMMENT 'Legacy GRN import: deduct TDS on this sub-head (NULL = unknown)'",
    'SELECT 1 -- finance_expense_sub_head_master.tds_enabled exists (or table absent)')
  FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'finance_expense_sub_head_master' AND COLUMN_NAME = 'tds_enabled');
PREPARE _s FROM @add_sh_tds_enabled; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @add_sh_tds_rate = (
  SELECT IF(COUNT(*) = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'finance_expense_sub_head_master') = 1,
    "ALTER TABLE finance_expense_sub_head_master ADD COLUMN tds_rate DECIMAL(6,3) NULL COMMENT 'TDS % on the taxable value'",
    'SELECT 1 -- finance_expense_sub_head_master.tds_rate exists (or table absent)')
  FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'finance_expense_sub_head_master' AND COLUMN_NAME = 'tds_rate');
PREPARE _s FROM @add_sh_tds_rate; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @add_sh_tds_ledger = (
  SELECT IF(COUNT(*) = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'finance_expense_sub_head_master') = 1,
    "ALTER TABLE finance_expense_sub_head_master ADD COLUMN tds_tally_ledger VARCHAR(200) NULL COMMENT 'Exact Tally TDS ledger, e.g. TDS RENT 2022-23'",
    'SELECT 1 -- finance_expense_sub_head_master.tds_tally_ledger exists (or table absent)')
  FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'finance_expense_sub_head_master' AND COLUMN_NAME = 'tds_tally_ledger');
PREPARE _s FROM @add_sh_tds_ledger; EXECUTE _s; DEALLOCATE PREPARE _s;

SET @add_vm_tds_ledger = (
  SELECT IF(COUNT(*) = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vendor_master') = 1,
    "ALTER TABLE vendor_master ADD COLUMN tds_tally_ledger VARCHAR(200) NULL COMMENT 'Exact Tally TDS ledger for this vendor when its sub-head has none'",
    'SELECT 1 -- vendor_master.tds_tally_ledger exists (or table absent)')
  FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vendor_master' AND COLUMN_NAME = 'tds_tally_ledger');
PREPARE _s FROM @add_vm_tds_ledger; EXECUTE _s; DEALLOCATE PREPARE _s;

SELECT '2205_grn_tally_legacy_ledgers.sql applied' AS migration_status;
