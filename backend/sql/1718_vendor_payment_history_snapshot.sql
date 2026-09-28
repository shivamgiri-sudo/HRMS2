-- ============================================================
-- Migration 1718: vendor payment / paid-history snapshot
--
-- db_bill has never had a mirror for the tables that record what was
-- actually PAID to vendors (as opposed to what was invoiced/GRN'd, which
-- billing_invoice_snapshot / grn_entry_snapshot already cover). This adds
-- read-only snapshot tables for:
--
--   tbl_payment                -> vendor_payment_run_snapshot
--   bill_pay_particulars       -> vendor_bill_payment_snapshot
--   other_deductions_bill      -> vendor_bill_deduction_snapshot
--   billing_ledger             -> billing_client_ledger_snapshot
--   billing_opening_balance    -> billing_opening_balance_snapshot
--   bill_no_master             -> bill_no_master_snapshot
--
-- Additive only. No existing table/column is touched. Populated by
-- backend/scripts/sync-db-bill-snapshot.mjs (syncs 14-19).
-- ============================================================

-- 1. vendor_payment_run_snapshot — from db_bill.tbl_payment
--    One row per payment RUN (a batch of bills paid together in one
--    bank transaction / cheque / RTGS).
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS vendor_payment_run_snapshot (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  bill_source_id      INT(11)      NOT NULL COMMENT 'db_bill.tbl_payment.id',
  company_name        VARCHAR(200) NULL,
  financial_year      VARCHAR(20)  NULL,
  branch_name         VARCHAR(100) NULL,
  pay_type            VARCHAR(50)  NULL,
  pay_no              INT          NULL,
  bank_name           VARCHAR(100) NULL,
  pay_date            DATE         NULL,
  pay_amount          DECIMAL(18,2) NOT NULL DEFAULT 0,
  deposit_bank        VARCHAR(100) NULL,
  no_of_bills         INT          NULL,
  pay_type_date       DATETIME     NULL,
  paid_bill_refs      TEXT         NULL COMMENT 'db_bill pay_of_these_bills — raw list of bill ids paid in this run',
  raised_by           VARCHAR(100) NULL COMMENT 'db_bill username',
  payment_file        VARCHAR(255) NULL COMMENT 'db_bill PaymentFile — proof/voucher filename, file itself not migrated',
  is_approved         TINYINT(1)   NULL,
  source_created_at   DATETIME     NULL,
  synced_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_payment_run_source (bill_source_id),
  INDEX idx_run_branch_fy (branch_name, financial_year),
  INDEX idx_run_pay_date (pay_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='Read-only mirror of db_bill.tbl_payment — vendor payment run headers (money that actually went out)';

-- 2. vendor_bill_payment_snapshot — from db_bill.bill_pay_particulars
--    One row per BILL inside a payment run: TDS deducted, net amount
--    actually paid, pass/reject status, remarks. This is the real
--    "paid history" the ATS/finance question was about.
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS vendor_bill_payment_snapshot (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  bill_source_id      INT(11)      NOT NULL COMMENT 'db_bill.bill_pay_particulars.id',
  payment_ref         VARCHAR(50)  NULL COMMENT 'db_bill PaymentId — sparse/unreliable, kept as-is',
  company_name        VARCHAR(200) NULL,
  branch_name         VARCHAR(100) NULL,
  financial_year      VARCHAR(20)  NULL,
  pay_type            VARCHAR(50)  NULL,
  pay_no              VARCHAR(50)  NULL COMMENT 'joins loosely to vendor_payment_run_snapshot.pay_no + branch + financial_year, not a hard FK',
  bank_name           VARCHAR(100) NULL,
  pay_date_raw        VARCHAR(50)  NULL COMMENT 'db_bill pay_dates is free-text/varchar at source, kept verbatim',
  pay_amount          DECIMAL(18,2) NOT NULL DEFAULT 0,
  deposit_bank        VARCHAR(100) NULL,
  no_of_bills         VARCHAR(20)  NULL,
  bill_no             VARCHAR(200) NULL,
  bill_amount         DECIMAL(18,2) NOT NULL DEFAULT 0,
  bill_passed         VARCHAR(50)  NULL,
  tds_deducted        DECIMAL(18,2) NOT NULL DEFAULT 0,
  net_amount          DECIMAL(18,2) NOT NULL DEFAULT 0,
  deduction           DECIMAL(18,2) NOT NULL DEFAULT 0,
  status              VARCHAR(50)  NULL,
  remarks             VARCHAR(500) NULL,
  pay_type_date       DATETIME     NULL,
  collection_id       VARCHAR(50)  NULL,
  raised_by           VARCHAR(100) NULL COMMENT 'db_bill username',
  is_deleted           TINYINT(1)   NOT NULL DEFAULT 0 COMMENT 'db_bill delete_status',
  payment_file        VARCHAR(255) NULL,
  is_dialdesk         TINYINT(1)   NULL,
  source_created_at   DATETIME     NULL,
  synced_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_bill_payment_source (bill_source_id),
  INDEX idx_bp_bill_no (bill_no(80)),
  INDEX idx_bp_branch_fy (branch_name, financial_year),
  INDEX idx_bp_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='Read-only mirror of db_bill.bill_pay_particulars — per-bill paid history: TDS deducted, net amount paid, pass/reject status';

-- 3. vendor_bill_deduction_snapshot — from db_bill.other_deductions_bill
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS vendor_bill_deduction_snapshot (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  bill_source_id      INT(11)      NOT NULL COMMENT 'db_bill.other_deductions_bill.id',
  company_name        VARCHAR(200) NULL,
  branch_name         VARCHAR(100) NULL,
  financial_year      VARCHAR(20)  NULL,
  pay_type            VARCHAR(50)  NULL,
  pay_no              VARCHAR(50)  NULL,
  pay_amount          DECIMAL(18,2) NOT NULL DEFAULT 0,
  bank_name           VARCHAR(100) NULL,
  deposit_bank        VARCHAR(100) NULL,
  pay_date            DATETIME     NULL,
  no_of_bills         INT          NULL,
  pay_type_date       DATETIME     NULL,
  status              TINYINT(1)   NULL,
  bill_no             VARCHAR(200) NULL,
  other_deduction     DECIMAL(18,2) NOT NULL DEFAULT 0,
  other_remarks       VARCHAR(500) NULL,
  collection_id       VARCHAR(50)  NULL,
  raised_by           VARCHAR(100) NULL,
  payment_file        VARCHAR(255) NULL,
  source_created_at   DATETIME     NULL,
  synced_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_bill_deduction_source (bill_source_id),
  INDEX idx_bd_bill_no (bill_no(80)),
  INDEX idx_bd_branch_fy (branch_name, financial_year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='Read-only mirror of db_bill.other_deductions_bill — extra deductions applied on vendor bills before payment';

-- 4. billing_client_ledger_snapshot — from db_bill.billing_ledger
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS billing_client_ledger_snapshot (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  bill_source_id      INT(11)      NOT NULL COMMENT 'db_bill.billing_ledger.led_id',
  finance_year        VARCHAR(20)  NULL,
  finance_month       VARCHAR(20)  NULL,
  client_source_id    INT(11)      NULL COMMENT 'db_bill.billing_ledger.clientId — joins bill_client_snapshot.bill_source_id',
  subscription_amt    DECIMAL(18,2) NOT NULL DEFAULT 0,
  talktime_amt        DECIMAL(18,2) NOT NULL DEFAULT 0,
  topup_amt           DECIMAL(18,2) NOT NULL DEFAULT 0,
  setup_cost_amt      DECIMAL(18,2) NOT NULL DEFAULT 0,
  synced_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ledger_source (bill_source_id),
  INDEX idx_ledger_client (client_source_id),
  INDEX idx_ledger_fy (finance_year, finance_month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='Read-only mirror of db_bill.billing_ledger — client subscription/talktime/topup/setup-cost billing ledger';

-- 5. billing_opening_balance_snapshot — from db_bill.billing_opening_balance
--    (current balance only; the *_history table is a smaller audit trail
--    of past revisions and is not mirrored in this pass.)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS billing_opening_balance_snapshot (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  bill_source_id      INT(11)      NOT NULL COMMENT 'db_bill.billing_opening_balance.op_id',
  client_source_id    INT(11)      NULL COMMENT 'joins bill_client_snapshot.bill_source_id',
  opening_balance     DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT 'db_bill op_bal',
  cs_balance          DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT 'db_bill cs_bal',
  opening_dd          VARCHAR(100) NULL COMMENT 'db_bill op_dd',
  bill_start_date     DATE         NULL,
  bill_end_date       DATE         NULL,
  fr_val              VARCHAR(100) NULL,
  fv_st_rl            VARCHAR(100) NULL,
  subscription_val    DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT 'db_bill subs_val',
  advance_val         DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT 'db_bill adv_val',
  as_on_date          DATETIME     NULL,
  source_created_at   DATETIME     NULL,
  source_updated_at   DATETIME     NULL,
  synced_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ob_source (bill_source_id),
  INDEX idx_ob_client (client_source_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='Read-only mirror of db_bill.billing_opening_balance — client opening balances carried into the billing system';

-- 6. bill_no_master_snapshot — from db_bill.bill_no_master
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS bill_no_master_snapshot (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  bill_source_id      INT(11)      NOT NULL COMMENT 'db_bill.bill_no_master.id',
  company_name        VARCHAR(200) NULL,
  finance_year        VARCHAR(20)  NULL,
  bill_no             INT          NULL,
  is_rtgs             TINYINT(1)   NULL,
  cost_centre_source_id INT(11)    NULL COMMENT 'db_bill cost_center — numeric id in this table, unlike most others which carry the code',
  proforma_bill_no    VARCHAR(200) NULL,
  month_year          VARCHAR(20)  NULL,
  is_active           TINYINT(1)   NULL,
  source_created_at   DATETIME     NULL,
  synced_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_bnm_source (bill_source_id),
  INDEX idx_bnm_fy (finance_year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='Read-only mirror of db_bill.bill_no_master — bill numbering sequence master';
