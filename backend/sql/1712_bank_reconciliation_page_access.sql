-- 1712_bank_reconciliation_page_access.sql
--
-- Payment Voucher System Phase 4. Registers /finance/bank-reconciliation. accounts_head gets
-- create/edit (upload, match, close); other finance roles are view-only, matching 1707's
-- pattern for the sibling Bank Ledger page.
INSERT INTO page_catalog (page_code, page_name, page_path, module, description, active_status)
VALUES (
  'FINANCE_BANK_RECONCILIATION', 'Bank Reconciliation', '/finance/bank-reconciliation', 'finance',
  'Match released vouchers against the real bank statement, post adjustments, and close periods so the Tally export can go final.', 1
)
ON DUPLICATE KEY UPDATE page_name = VALUES(page_name), page_path = VALUES(page_path), module = VALUES(module), description = VALUES(description), active_status = VALUES(active_status);

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  (UUID(), 'super_admin',   'FINANCE_BANK_RECONCILIATION', 1, 1, 1, 0, 1, 1),
  (UUID(), 'accounts_head', 'FINANCE_BANK_RECONCILIATION', 1, 1, 1, 0, 1, 1),
  (UUID(), 'finance_head',  'FINANCE_BANK_RECONCILIATION', 1, 0, 0, 0, 1, 1),
  (UUID(), 'ceo',           'FINANCE_BANK_RECONCILIATION', 1, 0, 0, 0, 1, 1),
  (UUID(), 'admin',         'FINANCE_BANK_RECONCILIATION', 1, 0, 0, 0, 1, 1),
  (UUID(), 'finance',       'FINANCE_BANK_RECONCILIATION', 1, 0, 0, 0, 1, 1)
ON DUPLICATE KEY UPDATE can_view = VALUES(can_view), can_create = VALUES(can_create), can_edit = VALUES(can_edit), can_export = VALUES(can_export), active_status = VALUES(active_status);

SELECT '1712_bank_reconciliation_page_access.sql applied' AS migration_status;

-- Rollback:
--   UPDATE role_page_access SET active_status = 0 WHERE page_code = 'FINANCE_BANK_RECONCILIATION';
--   UPDATE page_catalog     SET active_status = 0 WHERE page_code = 'FINANCE_BANK_RECONCILIATION';
