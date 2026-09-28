-- 1706_payment_voucher_pages_access.sql
--
-- Registers the two new Phase 1 pages in the page catalog and grants role-based access,
-- following the exact pattern of 1548_unlinked_grn_review_page_access.sql. Roles mirror the
-- backend route-role constants in company-bank-account.routes.ts / payment-voucher.routes.ts
-- exactly, per the repo convention that a frontend gate must never show a page the API would
-- refuse — including finance_head/ceo/accounts_head/branch_head/admin/finance as read roles
-- so every seat in the raise/approve/release chain can at least see the queue.
INSERT INTO page_catalog (page_code, page_name, page_path, module, description, active_status)
VALUES
  ('FINANCE_BANK_ACCOUNTS', 'Company Bank Accounts', '/finance/bank-accounts', 'finance',
   'The company''s own paying/receiving bank accounts — master data behind the Payment Voucher system and the Bank Account Ledger.', 1),
  ('FINANCE_PAYMENT_VOUCHERS', 'Payment Vouchers', '/finance/payment-vouchers', 'finance',
   'Raise, CEO-approve and release payment vouchers — the authorization chain that moves money and writes the bank ledger.', 1)
ON DUPLICATE KEY UPDATE
  page_name     = VALUES(page_name),
  page_path     = VALUES(page_path),
  module        = VALUES(module),
  description   = VALUES(description),
  active_status = VALUES(active_status);

INSERT INTO role_page_access
  (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  (UUID(), 'super_admin',   'FINANCE_BANK_ACCOUNTS', 1, 1, 1, 0, 1, 1),
  (UUID(), 'finance_head',  'FINANCE_BANK_ACCOUNTS', 1, 1, 1, 0, 1, 1),
  (UUID(), 'accounts_head', 'FINANCE_BANK_ACCOUNTS', 1, 1, 1, 0, 1, 1),
  (UUID(), 'admin',         'FINANCE_BANK_ACCOUNTS', 1, 0, 0, 0, 1, 1),
  (UUID(), 'finance',       'FINANCE_BANK_ACCOUNTS', 1, 0, 0, 0, 1, 1),

  (UUID(), 'super_admin',   'FINANCE_PAYMENT_VOUCHERS', 1, 1, 1, 0, 1, 1),
  (UUID(), 'finance_head',  'FINANCE_PAYMENT_VOUCHERS', 1, 1, 0, 0, 1, 1),
  (UUID(), 'ceo',           'FINANCE_PAYMENT_VOUCHERS', 1, 0, 0, 0, 1, 1),
  (UUID(), 'accounts_head', 'FINANCE_PAYMENT_VOUCHERS', 1, 0, 1, 0, 1, 1),
  (UUID(), 'branch_head',   'FINANCE_PAYMENT_VOUCHERS', 1, 0, 0, 0, 0, 1),
  (UUID(), 'admin',         'FINANCE_PAYMENT_VOUCHERS', 1, 0, 0, 0, 1, 1),
  (UUID(), 'finance',       'FINANCE_PAYMENT_VOUCHERS', 1, 0, 0, 0, 1, 1)
ON DUPLICATE KEY UPDATE
  can_view      = VALUES(can_view),
  can_create    = VALUES(can_create),
  can_edit      = VALUES(can_edit),
  can_delete    = VALUES(can_delete),
  can_export    = VALUES(can_export),
  active_status = VALUES(active_status);

SELECT '1706_payment_voucher_pages_access.sql applied' AS migration_status;

-- Rollback:
--   UPDATE role_page_access SET active_status = 0 WHERE page_code IN ('FINANCE_BANK_ACCOUNTS','FINANCE_PAYMENT_VOUCHERS');
--   UPDATE page_catalog     SET active_status = 0 WHERE page_code IN ('FINANCE_BANK_ACCOUNTS','FINANCE_PAYMENT_VOUCHERS');
