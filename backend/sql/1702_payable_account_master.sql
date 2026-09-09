-- 1702_payable_account_master.sql
--
-- The first chart-of-accounts / ledger-head table in this codebase. Today a "ledger name" is
-- always a free-text string picked at write time (ledger_name in salary-voucher.service.ts,
-- tally_head on gst_export_row/client_invoice) — there is nothing to select from and nothing
-- stopping two different strings meaning the same head. This table is that closed set, and
-- like company_bank_account (1701) it carries its own tally_ledger_name so a rename inside
-- HRMS never breaks a Tally import.
--
-- Seeded with the starter heads the Payment Voucher release step needs immediately: Vendor
-- Payables and TDS Payable for the vendor-GRN lane (PRD §6.5 — TDS withheld is booked
-- separately from the net vendor payment), Bank Charges/Interest Income for bank
-- reconciliation adjustments (a later phase, but the heads are seeded now so 1703's FK has
-- something to point at), Imprest Float for the imprest-allocation lane, Salary Payable and
-- Statutory Dues for parity with existing payroll/statutory ledger-head vocabulary, and Other
-- as the deliberate escape hatch.
CREATE TABLE IF NOT EXISTS payable_account_master (
  id                 CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  account_name       VARCHAR(255)  NOT NULL,
  account_type       ENUM('expense','payable','receivable','income','bank_charge','other') NOT NULL,
  tally_ledger_name  VARCHAR(255)  NOT NULL,
  active_status      TINYINT(1)    NOT NULL DEFAULT 1,
  created_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pam_account_name (account_name),
  INDEX idx_pam_active (active_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO payable_account_master (id, account_name, account_type, tally_ledger_name, active_status)
VALUES
  (UUID(), 'Vendor Payables',   'payable',     'Vendor Payables',   1),
  (UUID(), 'TDS Payable',       'payable',     'TDS Payable',       1),
  (UUID(), 'Salary Payable',    'payable',     'Salary Payable',    1),
  (UUID(), 'Statutory Dues',    'payable',     'Statutory Dues',    1),
  (UUID(), 'Imprest Float',     'other',       'Imprest Float',     1),
  (UUID(), 'Bank Charges',      'bank_charge', 'Bank Charges',      1),
  (UUID(), 'Interest Income',   'income',      'Interest Income',   1),
  (UUID(), 'Other',             'other',       'Other',             1)
ON DUPLICATE KEY UPDATE account_name = account_name;

SELECT '1702_payable_account_master.sql applied' AS migration_status;
