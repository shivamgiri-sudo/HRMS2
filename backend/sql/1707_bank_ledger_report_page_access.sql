-- 1707_bank_ledger_report_page_access.sql
--
-- Payment Voucher System Phase 2. Registers the Credit/Debit report page (PRD §6.1/§6.2) —
-- /finance/bank-ledger — following 1548/1706's exact pattern. Read/export only, no write
-- capability on this page: it renders bank_account_ledger_entry, which nothing on this page
-- ever writes to (rows are posted only by payment-voucher.service.ts's release()).
INSERT INTO page_catalog (page_code, page_name, page_path, module, description, active_status)
VALUES (
  'FINANCE_BANK_LEDGER',
  'Bank Account Ledger',
  '/finance/bank-ledger',
  'finance',
  'The Credit/Debit report — running bank book per account, filterable by date range, exportable to CSV for Tally hand-off.',
  1
)
ON DUPLICATE KEY UPDATE
  page_name     = VALUES(page_name),
  page_path     = VALUES(page_path),
  module        = VALUES(module),
  description   = VALUES(description),
  active_status = VALUES(active_status);

INSERT INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  (UUID(), 'super_admin',   'FINANCE_BANK_LEDGER', 1, 0, 0, 0, 1, 1),
  (UUID(), 'finance_head',  'FINANCE_BANK_LEDGER', 1, 0, 0, 0, 1, 1),
  (UUID(), 'accounts_head', 'FINANCE_BANK_LEDGER', 1, 0, 0, 0, 1, 1),
  (UUID(), 'ceo',           'FINANCE_BANK_LEDGER', 1, 0, 0, 0, 1, 1),
  (UUID(), 'admin',         'FINANCE_BANK_LEDGER', 1, 0, 0, 0, 1, 1),
  (UUID(), 'finance',       'FINANCE_BANK_LEDGER', 1, 0, 0, 0, 1, 1)
ON DUPLICATE KEY UPDATE
  can_view      = VALUES(can_view),
  can_export    = VALUES(can_export),
  active_status = VALUES(active_status);

SELECT '1707_bank_ledger_report_page_access.sql applied' AS migration_status;

-- Rollback:
--   UPDATE role_page_access SET active_status = 0 WHERE page_code = 'FINANCE_BANK_LEDGER';
--   UPDATE page_catalog     SET active_status = 0 WHERE page_code = 'FINANCE_BANK_LEDGER';
