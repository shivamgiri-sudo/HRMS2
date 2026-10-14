-- Client receipts (Receivables & Money Flow, docs/superpowers/specs/2026-10-14-receivables-money-flow-design.md).
-- ADDITIVE ONLY. New tables + two nullable/defaulted columns; no existing row is changed.
--   * client_receipt: money received from a client, entered in HRMS. One sales_receipt payment voucher
--     per receipt (voucher_id) carries the bank credit through raise -> approve -> release.
--   * client_receipt_allocation: how much of the receipt settles each bill: received + TDS + deduction.
--     A bill's outstanding = grand_total - settled (non-void receipts whose voucher is not
--     rejected/withdrawn) - approved credit notes. Computed live, never cached as truth.
--   * client_invoice.due_date: invoice_date + credit days (cost centre payment_terms, default 30), set
--     when the bill number is minted. NULL on existing bills (readers fall back to the same rule).
--   * client_invoice_payment_status.other_deduction: kept in step with allocations for the legacy screens.
--   * client_provision.legacy_source_id (unique): I-Spark provision_master id for the idempotent import.
-- Money is DECIMAL(14,2); every amount is computed in integer paise in code.
-- Rollback (manual): DROP TABLE client_receipt_allocation, client_receipt;
--   ALTER TABLE client_invoice DROP COLUMN due_date; ALTER TABLE client_invoice_payment_status DROP COLUMN other_deduction;
--   ALTER TABLE client_provision DROP INDEX uq_cp_legacy_source, DROP COLUMN legacy_source_id;

CREATE TABLE IF NOT EXISTS client_receipt (
  id                CHAR(36)      NOT NULL PRIMARY KEY,
  receipt_no        VARCHAR(40)   NOT NULL,
  finance_year      VARCHAR(10)   NOT NULL,
  receipt_date      DATE          NOT NULL,
  client_name       VARCHAR(255)  NOT NULL,
  company_name      VARCHAR(255)  NULL,
  branch_id         CHAR(36)      NULL,
  amount_received   DECIMAL(14,2) NOT NULL,
  tds_amount        DECIMAL(14,2) NOT NULL DEFAULT 0,
  other_deduction   DECIMAL(14,2) NOT NULL DEFAULT 0,
  payment_mode      ENUM('NEFT','RTGS','IMPS','UPI','Cheque','DD','Cash','Other') NOT NULL,
  reference_no      VARCHAR(100)  NULL,
  bank_account_id   CHAR(36)      NULL,      -- required for receipts entered in HRMS; NULL only on I-Spark imports
  voucher_id        CHAR(36)      NULL,
  status            ENUM('recorded','void') NOT NULL DEFAULT 'recorded',
  void_reason       VARCHAR(500)  NULL,
  voided_by         CHAR(36)      NULL,
  voided_at         DATETIME      NULL,
  remarks           VARCHAR(500)  NULL,
  created_by        CHAR(36)      NOT NULL,
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_migrated       TINYINT(1)    NOT NULL DEFAULT 0,
  legacy_source_id  VARCHAR(64)   NULL,
  UNIQUE KEY uq_cr_receipt_no (receipt_no),
  UNIQUE KEY uq_cr_legacy_source (legacy_source_id),
  KEY idx_cr_date (receipt_date),
  KEY idx_cr_branch (branch_id),
  KEY idx_cr_voucher (voucher_id),
  KEY idx_cr_client (client_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS client_receipt_allocation (
  id                CHAR(36)      NOT NULL PRIMARY KEY,
  receipt_id        CHAR(36)      NOT NULL,
  invoice_id        CHAR(36)      NOT NULL,
  received_amount   DECIMAL(14,2) NOT NULL DEFAULT 0,
  tds_amount        DECIMAL(14,2) NOT NULL DEFAULT 0,
  deduction_amount  DECIMAL(14,2) NOT NULL DEFAULT 0,
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cra_receipt_invoice (receipt_id, invoice_id),
  KEY idx_cra_invoice (invoice_id),
  CONSTRAINT fk_cra_receipt FOREIGN KEY (receipt_id) REFERENCES client_receipt(id),
  CONSTRAINT fk_cra_invoice FOREIGN KEY (invoice_id) REFERENCES client_invoice(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @add_client_invoice_due_date = (
  SELECT IF(
    COUNT(*) = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_invoice') = 1,
    "ALTER TABLE client_invoice ADD COLUMN due_date DATE NULL",
    'SELECT 1 -- client_invoice.due_date already exists (or table absent)'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_invoice' AND COLUMN_NAME = 'due_date'
);
PREPARE _stmt FROM @add_client_invoice_due_date;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @add_client_invoice_payment_status_other_deduction = (
  SELECT IF(
    COUNT(*) = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_invoice_payment_status') = 1,
    "ALTER TABLE client_invoice_payment_status ADD COLUMN other_deduction DECIMAL(14,2) NOT NULL DEFAULT 0",
    'SELECT 1 -- client_invoice_payment_status.other_deduction already exists (or table absent)'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_invoice_payment_status' AND COLUMN_NAME = 'other_deduction'
);
PREPARE _stmt FROM @add_client_invoice_payment_status_other_deduction;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;

SET @add_client_provision_legacy_source_id = (
  SELECT IF(
    COUNT(*) = 0 AND (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_provision') = 1,
    "ALTER TABLE client_provision ADD COLUMN legacy_source_id VARCHAR(64) NULL, ADD UNIQUE KEY uq_cp_legacy_source (legacy_source_id)",
    'SELECT 1 -- client_provision.legacy_source_id already exists (or table absent)'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'client_provision' AND COLUMN_NAME = 'legacy_source_id'
);
PREPARE _stmt FROM @add_client_provision_legacy_source_id;
EXECUTE _stmt;
DEALLOCATE PREPARE _stmt;
