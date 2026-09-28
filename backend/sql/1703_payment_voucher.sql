-- 1703_payment_voucher.sql
--
-- The authorization + release chain for money leaving/entering a company_bank_account.
-- Three distinct roles, three distinct actions, deliberately not "two approvals plus an
-- auto-post": Finance Head RAISES (bank + payable account + remarks, no transaction detail —
-- money hasn't moved), CEO APPROVES (a yes/no on amount/purpose), Accounts Head RELEASES
-- (actually executes the transfer and keys in the real payment_mode/date/transaction_ref).
-- payment-voucher.service.ts enforces raised_by != ceo_approved_by != released_by
-- server-side — the same pairwise-inequality shape vendor-approval.service.ts and
-- vendor-bank.service.ts already use ("a route guard proves a role, it cannot prove two
-- different people") — the WHERE-clause status guards below are the optimistic-lock half of
-- that, matching grn.service.ts's `AND status = 'branch_head_approved'` convention so a
-- concurrent double-approval affects zero rows instead of firing twice.
--
-- source_type carries a third value, 'sales_receipt', reserved for a later phase (PRD §6.6)
-- and unused by any service code in this migration — declaring it now avoids widening this
-- ENUM later.
CREATE TABLE IF NOT EXISTS payment_voucher (
  id                          CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  voucher_number              VARCHAR(64)   NULL COMMENT 'PV/<branch_code>/<YYYYMM>/<seq>, assigned at raise. Carried into Tally VOUCHERNUMBER in a later phase so a re-export is idempotent.',
  voucher_type                ENUM('payment','receipt') NOT NULL DEFAULT 'payment',
  source_type                 ENUM('vendor_grn','imprest_allocation','sales_receipt') NOT NULL,
  bank_account_id              CHAR(36)      NOT NULL,
  payable_account_id           CHAR(36)      NOT NULL,
  linked_vendor_payment_id     CHAR(36)      NULL COMMENT 'FK vendor_payment_tracking, when source_type=vendor_grn.',
  linked_imprest_manager_id    CHAR(36)      NULL COMMENT 'FK imprest_manager, when source_type=imprest_allocation.',
  linked_client_invoice_id     CHAR(36)      NULL COMMENT 'Reserved for sales_receipt — unused this phase.',
  amount                       DECIMAL(18,2) NOT NULL COMMENT 'Net payable — for vendor_grn this is due_amount minus tds_deducted_amount (PRD §6.5), TDS withheld is booked as its own ledger entry, not subtracted from a gross figure here.',
  remarks                      TEXT          NULL,
  reason                       TEXT          NULL,
  status                       ENUM('draft','raised','ceo_approved','rejected','released') NOT NULL DEFAULT 'draft',
  raised_by                    CHAR(36)      NULL,
  raised_at                    DATETIME      NULL,
  ceo_approved_by              CHAR(36)      NULL,
  ceo_approved_at              DATETIME      NULL,
  released_by                  CHAR(36)      NULL,
  released_at                  DATETIME      NULL,
  payment_mode                 ENUM('Cheque','NEFT','RTGS','IMPS','UPI','Cash','Bank Transfer','Adjustment','Other') NULL COMMENT 'Filled only at release — same ENUM as vendor_payment_tracking.payment_mode so the two stay directly comparable.',
  payment_date                 DATE          NULL,
  transaction_ref               VARCHAR(100)  NULL,
  rejection_reason              TEXT          NULL,
  created_at                   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pv_voucher_number (voucher_number),
  INDEX idx_pv_status (status),
  INDEX idx_pv_bank_account (bank_account_id),
  INDEX idx_pv_vendor_payment (linked_vendor_payment_id),
  INDEX idx_pv_imprest_manager (linked_imprest_manager_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT '1703_payment_voucher.sql applied' AS migration_status;
