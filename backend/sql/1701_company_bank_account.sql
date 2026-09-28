-- 1701_company_bank_account.sql
--
-- WHY
-- HRMS2 has no representation of the company's OWN bank accounts anywhere. bank_master
-- (310_vendor_payment_tracking.sql) is a generic name/IFSC-prefix directory used only as a
-- dropdown for "which bank did this payment go through" — it has no account number and is
-- not tied to a specific account. vendor-bank.service.ts's own header comment confirms the
-- gap explicitly: "db_bill's bill_pay_particulars.deposit_bank is our OWN paying account, not
-- the payee. The coordinates live in Tally only." This table is the first HRMS2 record of
-- which bank account money actually moves through — the base the new Payment Voucher /
-- Bank Ledger / Bank Reconciliation system is built on.
--
-- ENCRYPTION
-- account_number_enc + account_number_key_version copy the exact dual-column pattern already
-- used for employee_bank_detail (1110_bank_account_number_encryption.sql) and
-- employees (606_employees_bank_account_encrypted.sql): AES-256-GCM ciphertext via
-- fieldEncryption.ts (encryptField/decryptField), TEXT column (ciphertext is base64, so no
-- charset/collation concern), key version recorded for a rotation that is not yet
-- implemented anywhere in this codebase. No new crypto code — company-bank-account.service.ts
-- calls the same shared module.
--
-- CREATE TABLE IF NOT EXISTS is safe MySQL 8 syntax (unlike ADD COLUMN IF NOT EXISTS, which
-- 1110's own header explains MySQL 8.0.42 rejects) — no guard idiom needed for a brand-new
-- table.
CREATE TABLE IF NOT EXISTS company_bank_account (
  id                          CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  bank_id                     CHAR(36)      NOT NULL,
  account_name                VARCHAR(255)  NOT NULL,
  account_number_enc          TEXT          NULL COMMENT 'AES-256-GCM ciphertext (fieldEncryption.ts format). The only place the full account number is ever stored.',
  account_number_last4        VARCHAR(4)    NULL COMMENT 'Display-only, never the full number — same convention as vendor_bank_detail.account_number_last4.',
  account_number_key_version  TINYINT UNSIGNED NULL,
  ifsc_code                   VARCHAR(11)   NOT NULL,
  branch_id                   CHAR(36)      NOT NULL COMMENT 'Which company branch/entity owns this account.',
  tally_ledger_name           VARCHAR(255)  NOT NULL COMMENT 'Exact ledger name as it exists in Tally. Internal account_name may differ; every export writes THIS field, never account_name, so a rename inside HRMS never breaks a Tally import.',
  opening_balance              DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT 'Opening balance for the current open period. Reset by bank_reconciliation close in a later phase — set here only at account creation.',
  opening_balance_as_of        DATE          NULL,
  active_status                TINYINT(1)    NOT NULL DEFAULT 1,
  closed_date                  DATE          NULL COMMENT 'Set when the account is closed. active_status=0 stops new vouchers against it while its historical ledger stays readable.',
  created_by                   CHAR(36)      NULL,
  created_at                   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by                   CHAR(36)      NULL,
  updated_at                   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_cba_bank (bank_id),
  INDEX idx_cba_branch (branch_id),
  INDEX idx_cba_active (active_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT '1701_company_bank_account.sql applied' AS migration_status;
