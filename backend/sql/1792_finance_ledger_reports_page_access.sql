-- 1792_finance_ledger_reports_page_access.sql
--
-- Registers /finance/ledger-reports (LedgerReportsPage.tsx: Trial Balance, Vendor Ledger,
-- Head/Subhead Spend) in page_catalog/role_page_access — without this, WorkforcePageGate
-- refuses the page even for a role the route itself allows (see hrms2-page-access-four-
-- independent-gates: route roles is only one of the four checks). Roles match exactly
-- BANK_ACCOUNT_READ_ROLES in company-bank-account.routes.ts, which ledger-reports.routes.ts
-- already reuses for every endpoint on this page (its own header comment explains why: "who
-- can see the bank ledger" and "who can see the trial balance/vendor ledger/head-subhead
-- ledger" are the same people in this codebase's role model).
--
-- Entirely read-only — can_create/can_edit/can_delete are 0 for every role, there is no write
-- action anywhere on this page. can_export is 0 too: no export button was built.

INSERT INTO page_catalog (page_code, page_name, page_path, module, description, active_status)
VALUES
  ('FINANCE_LEDGER_REPORTS', 'Ledger Reports', '/finance/ledger-reports', 'finance',
   'Trial Balance, Vendor Ledger and Head/Subhead spend read directly off the double-entry journal (journal_entry_line).', 1)
ON DUPLICATE KEY UPDATE
  page_name = VALUES(page_name), page_path = VALUES(page_path), module = VALUES(module),
  description = VALUES(description), active_status = VALUES(active_status);

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export, active_status)
VALUES
  (UUID(), 'super_admin',   'FINANCE_LEDGER_REPORTS', 1, 0, 0, 0, 0, 1),
  (UUID(), 'accounts_head', 'FINANCE_LEDGER_REPORTS', 1, 0, 0, 0, 0, 1),
  (UUID(), 'finance_head',  'FINANCE_LEDGER_REPORTS', 1, 0, 0, 0, 0, 1),
  (UUID(), 'ceo',           'FINANCE_LEDGER_REPORTS', 1, 0, 0, 0, 0, 1),
  (UUID(), 'branch_head',   'FINANCE_LEDGER_REPORTS', 1, 0, 0, 0, 0, 1),
  (UUID(), 'admin',         'FINANCE_LEDGER_REPORTS', 1, 0, 0, 0, 0, 1),
  (UUID(), 'finance',       'FINANCE_LEDGER_REPORTS', 1, 0, 0, 0, 0, 1)
ON DUPLICATE KEY UPDATE
  can_view = VALUES(can_view), active_status = VALUES(active_status);

SELECT '1792_finance_ledger_reports_page_access.sql applied' AS migration_status;

-- Rollback:
--   UPDATE role_page_access SET active_status = 0 WHERE page_code = 'FINANCE_LEDGER_REPORTS';
--   UPDATE page_catalog     SET active_status = 0 WHERE page_code = 'FINANCE_LEDGER_REPORTS';
