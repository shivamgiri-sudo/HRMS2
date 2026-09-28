-- 1825_receipt_receivable_ledger_heads.sql
--
-- The Record Client Receipt form filters payable_account_master for account_type IN
-- ('receivable','income'). The 1702 seed only inserted payable/other/bank_charge/income
-- types — no receivable row — so the Payable Account dropdown on the receipt form was
-- always empty. This migration adds the missing heads so the form is usable.
--
-- "Sundry Debtors" is the standard Tally receivable head used for BPO client receipts.
-- "Other Receivables" is the catch-all for non-client inflows (refunds, deposits, etc.).

INSERT INTO payable_account_master (id, account_name, account_type, tally_ledger_name, active_status)
VALUES
  (UUID(), 'Sundry Debtors',    'receivable', 'Sundry Debtors',    1),
  (UUID(), 'Other Receivables', 'receivable', 'Other Receivables', 1)
ON DUPLICATE KEY UPDATE account_name = account_name;

SELECT '1825_receipt_receivable_ledger_heads.sql applied' AS migration_status;
