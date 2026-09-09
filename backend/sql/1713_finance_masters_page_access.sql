-- 1713_finance_masters_page_access.sql
--
-- Payment Voucher System Phase 5. Registers admin UI for the two masters the Payment Voucher /
-- Bank Ledger / Bank Reconciliation system depends on that had no management screen until now:
--   - payable_account_master (1702) — backend CRUD already existed (payable-account.routes.ts),
--     this only adds the page; it was API-only, unreachable from the UI.
--   - bank_master (310_vendor_payment_tracking.sql) — was DB-seed-only (20 hardcoded banks),
--     both the write API (bank-master.routes.ts) and this page are new.
-- Same write-role set as company_bank_account (1706): finance_head/accounts_head/super_admin
-- write, wider finance roles read.
INSERT INTO page_catalog (page_code, page_name, page_path, module, description, active_status)
VALUES
  ('FINANCE_LEDGER_HEADS', 'Ledger Heads', '/finance/ledger-heads', 'finance',
   'Chart-of-accounts master — the ledger heads Payment Vouchers and Bank Reconciliation adjustments post against.', 1),
  ('FINANCE_BANK_DIRECTORY', 'Bank Directory', '/finance/bank-directory', 'finance',
   'The list of banks offered when setting up a company bank account.', 1)
ON DUPLICATE KEY UPDATE
  page_name = VALUES(page_name), page_path = VALUES(page_path), module = VALUES(module),
  description = VALUES(description), active_status = VALUES(active_status);

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  (UUID(), 'super_admin',   'FINANCE_LEDGER_HEADS', 1, 1, 1, 0, 0, 1),
  (UUID(), 'accounts_head', 'FINANCE_LEDGER_HEADS', 1, 1, 1, 0, 0, 1),
  (UUID(), 'finance_head',  'FINANCE_LEDGER_HEADS', 1, 1, 1, 0, 0, 1),
  (UUID(), 'ceo',           'FINANCE_LEDGER_HEADS', 1, 0, 0, 0, 0, 1),
  (UUID(), 'admin',         'FINANCE_LEDGER_HEADS', 1, 0, 0, 0, 0, 1),
  (UUID(), 'finance',       'FINANCE_LEDGER_HEADS', 1, 0, 0, 0, 0, 1),
  (UUID(), 'super_admin',   'FINANCE_BANK_DIRECTORY', 1, 1, 1, 0, 0, 1),
  (UUID(), 'accounts_head', 'FINANCE_BANK_DIRECTORY', 1, 1, 1, 0, 0, 1),
  (UUID(), 'finance_head',  'FINANCE_BANK_DIRECTORY', 1, 1, 1, 0, 0, 1),
  (UUID(), 'ceo',           'FINANCE_BANK_DIRECTORY', 1, 0, 0, 0, 0, 1),
  (UUID(), 'admin',         'FINANCE_BANK_DIRECTORY', 1, 0, 0, 0, 0, 1),
  (UUID(), 'finance',       'FINANCE_BANK_DIRECTORY', 1, 0, 0, 0, 0, 1)
ON DUPLICATE KEY UPDATE
  can_view = VALUES(can_view), can_create = VALUES(can_create), can_edit = VALUES(can_edit), active_status = VALUES(active_status);

SELECT '1713_finance_masters_page_access.sql applied' AS migration_status;

-- Rollback:
--   UPDATE role_page_access SET active_status = 0 WHERE page_code IN ('FINANCE_LEDGER_HEADS','FINANCE_BANK_DIRECTORY');
--   UPDATE page_catalog     SET active_status = 0 WHERE page_code IN ('FINANCE_LEDGER_HEADS','FINANCE_BANK_DIRECTORY');
