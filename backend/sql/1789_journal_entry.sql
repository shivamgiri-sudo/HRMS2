-- 1789_journal_entry.sql
--
-- WHY
-- tally-export.service.ts's own header comment says it plainly: "there is no general-ledger
-- table in this schema." GRN approval moves budget_consumption but posts nothing to a ledger.
-- Payment Voucher release posts only bank_account_ledger_entry — the BANK leg — and infers the
-- vendor-payable leg from vendor_payment_tracking.due_amount rather than posting it. TDS is a
-- zero-cash memo row that tally-export.service.ts has to detect and reconstruct into a third
-- voucher line at export time, purely because there is nowhere else for that liability to live.
--
-- This migration adds the missing spine: journal_entry (one row per accounting event) and
-- journal_entry_line (its balanced Dr/Cr lines). Nothing in this migration changes GRN or
-- Payment Voucher behaviour — wiring them to post through journal.service.ts is Phase 2/3 of
-- the plan this migration belongs to (docs/superpowers/plans, journal-task-1-brief.md).
--
-- WHY NOT ONE UNIFIED chart_of_accounts TABLE
-- HRMS2 already has four separate ledger-head masters, each purpose-built and already wired
-- into approvals, budgets and Tally export: company_bank_account (1701), vendor_master (024),
-- finance_expense_sub_head_master (412), payable_account_master (1702, the TDS/Salary
-- Payable/Bank Charges etc. catch-all). Collapsing these into one new master table would be a
-- second migration in itself and would orphan every existing FK. journal_entry_line instead
-- carries account_type + account_id and resolves against whichever of the four masters
-- account_type names, the same polymorphic-reference shape grn_request already uses for
-- budget_line_id vs cost_centre_id. A future consolidation into a real chart_of_accounts can
-- happen later without this table's shape changing.
--
-- WHY THE BALANCE RULE ISN'T A DB CONSTRAINT
-- MySQL TRIGGERs are unavailable in this environment (imprest-ledger.service.ts's header
-- comment states this directly, and a source-scan test enforces the append-only rule there
-- for the same reason). A CHECK per *row* can enforce "one side per line" but MySQL 8 cannot
-- CHECK an aggregate across sibling rows in the same statement. So SUM(debit) = SUM(credit)
-- per journal_entry_id is enforced in journal.service.ts's post() — the only writer this
-- table is allowed to have — inside a transaction, and proven by a source-scan test the same
-- way the append-only rule is proven (see journal.service.ts header).
--
-- Money is stored in DECIMAL(18,2) rupees throughout HRMS2 (payment_voucher.amount,
-- bank_account_ledger_entry.debit_amount/credit_amount) — journal_entry_line matches that,
-- and journal.service.ts compares in paise internally (toPaise/fromPaise, the same helper
-- pattern as imprest-ledger.service.ts) so two values that print the same always compare equal.

CREATE TABLE IF NOT EXISTS journal_entry (
  id            CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  entry_date    DATE          NOT NULL COMMENT 'Transaction date — GRN approval date, voucher release date, bank statement date.',
  narration     TEXT          NOT NULL,
  source_type   ENUM('grn','payment_voucher','bank_reconciliation_adjustment','imprest','manual')
                              NOT NULL COMMENT 'What business event produced this entry.',
  source_id     CHAR(36)      NOT NULL COMMENT 'FK grn_request.id / payment_voucher.id / bank_reconciliation_period.id, depending on source_type. Not a single FK — the referenced table varies.',
  posted_by     CHAR(36)      NOT NULL COMMENT 'The user whose approval/release action triggered this posting — not necessarily the logged-in caller of the HTTP request.',
  posted_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reversed_by_entry_id CHAR(36) NULL COMMENT 'Set when this entry has been superseded by a reversing contra entry (see journal.service.ts reverse()). A wrong posting is corrected with a contra entry, never an UPDATE — same discipline as bank_account_ledger_entry and imprest_transaction_ledger.',
  UNIQUE KEY uq_je_source (source_type, source_id, reversed_by_entry_id) COMMENT 'One LIVE (non-reversed) entry per source event. A reversed entry keeps its row (reversed_by_entry_id set) so a second post for the same source after a reversal is not blocked by this key.',
  INDEX idx_je_source (source_type, source_id),
  INDEX idx_je_date (entry_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS journal_entry_line (
  id                CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  journal_entry_id  CHAR(36)      NOT NULL,
  line_order        TINYINT       NOT NULL DEFAULT 0 COMMENT 'Preserves line order for Tally export (party line before bank line, TDS line last) without relying on insert order.',
  account_type      ENUM('bank_account','vendor','expense_sub_head','payable_account')
                                  NOT NULL COMMENT 'Which existing master table account_id resolves against: company_bank_account / vendor_master / finance_expense_sub_head_master / payable_account_master.',
  account_id        CHAR(36)      NOT NULL COMMENT 'FK into the table named by account_type. Not a single DB FK constraint, same reasoning as journal_entry.source_id.',
  debit_amount      DECIMAL(18,2) NOT NULL DEFAULT 0,
  credit_amount     DECIMAL(18,2) NOT NULL DEFAULT 0,
  narration         TEXT          NULL COMMENT 'Line-level detail (e.g. "TDS @2% withheld") when it differs from the header narration.',
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_jel_one_side CHECK (
    (debit_amount > 0 AND credit_amount = 0) OR (credit_amount > 0 AND debit_amount = 0)
  ) COMMENT 'A line moves exactly one side, Tally-style — the balance across the whole entry is what must net to zero, not any single line.',
  INDEX idx_jel_entry (journal_entry_id),
  INDEX idx_jel_account (account_type, account_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SELECT '1789_journal_entry.sql applied' AS migration_status;
