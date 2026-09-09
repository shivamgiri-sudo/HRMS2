-- 1704_bank_account_ledger_entry.sql
--
-- The running Bank Book — one immutable row per posted transaction affecting a
-- company_bank_account. Append-only by convention: payment-voucher.service.ts never issues
-- an UPDATE or DELETE against this table, the same discipline imprest_transaction_ledger
-- already holds ("a wrong entry is corrected with a contra entry, not an edit").
--
-- running_balance is computed and STORED at insert time under a row lock on the parent
-- company_bank_account (mirroring imprest-ledger.service.ts's `imprest_manager ... FOR
-- UPDATE` pattern) rather than derived live on every read the way imprest_transaction_ledger
-- deliberately is — PRD §3.2 asks for this specifically, for report performance and audit
-- stability on what will become the Tally export source.
--
-- voucher_id is nullable because a later phase (bank_reconciliation_adjustment) posts entries
-- with source_type='reconciliation_adjustment' that have no payment_voucher behind them at
-- all — a bank charge or an unrecorded credit is not authorized through the voucher chain.
CREATE TABLE IF NOT EXISTS bank_account_ledger_entry (
  id                  CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  bank_account_id      CHAR(36)      NOT NULL,
  entry_date           DATE          NOT NULL COMMENT 'Transaction date, not entry-creation date.',
  voucher_id           CHAR(36)      NULL COMMENT 'FK payment_voucher, set at release. NULL for reconciliation-originated entries (a later phase).',
  debit_amount         DECIMAL(18,2) NOT NULL DEFAULT 0,
  credit_amount        DECIMAL(18,2) NOT NULL DEFAULT 0,
  payable_account_id   CHAR(36)      NOT NULL COMMENT 'The other side of the entry — what this money relates to.',
  narration            TEXT          NOT NULL,
  instrument_ref       VARCHAR(100)  NULL COMMENT 'Cheque no. / UTR / transaction ID.',
  running_balance      DECIMAL(18,2) NOT NULL COMMENT 'Computed and stored at insert time — not recalculated on read.',
  source_type          ENUM('voucher','reconciliation_adjustment') NOT NULL DEFAULT 'voucher',
  created_at           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by           CHAR(36)      NULL,
  INDEX idx_bale_account_date (bank_account_id, entry_date),
  INDEX idx_bale_voucher (voucher_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT '1704_bank_account_ledger_entry.sql applied' AS migration_status;
