# Bank Reconciliation (Payment Voucher System Phase 4) — Design

## Context

Phases 1-3 of the Payment Voucher System are built and committed on this worktree
(`worktree-payment-voucher-phase1`):

- **Phase 1**: `company_bank_account`, `payable_account_master`, `payment_voucher` (raise →
  CEO-approve → release chain), `bank_account_ledger_entry` (the running bank book).
- **Phase 2**: Credit/Debit report (`bank-ledger.service.ts`) + imprest replenishment
  auto-flagging.
- **Phase 3**: Tally XML export (`tally-export.service.ts`) — every export is currently
  **provisional** (`isFinal` hardcoded `false`) because nothing can "close" a period yet.

This phase builds Bank Reconciliation: matching `bank_account_ledger_entry` (HRMS's record of
what was released) against the real bank statement, recording anything the bank shows that HRMS
doesn't (charges, interest), and closing a period so the Tally export for that range can finally
be marked final.

## Goal

Accounts Head uploads a bank statement (any CSV/Excel), the system auto-matches it against
unreconciled ledger entries, the Accounts Head resolves what's left manually (match or post as
an adjustment), then closes the period once the classic reconciliation formula balances:

```
HRMS computed closing balance − outstanding (unmatched, dated ≤ period end) = statement closing balance
```

Closing locks the entries in that period, carries the closing balance forward as next period's
opening balance, and flips the Tally export for that range from provisional to final.

Single-owner workflow: Accounts Head does the whole cycle (matches, resolves, closes), same as
they already own every `bank_account_ledger_entry` write via `release()`. Other finance roles
keep read access, matching the existing `BANK_ACCOUNT_READ_ROLES` gate.

## Data model

### `bank_reconciliation_period` (new, sql/1708)
One row per bank account per reconciliation window.

| column | notes |
|---|---|
| `id` | CHAR(36) PK |
| `bank_account_id` | FK `company_bank_account` |
| `from_date` / `to_date` | DATE, the window being reconciled |
| `status` | ENUM('open','closed') DEFAULT 'open' |
| `opening_balance` | DECIMAL(18,2), copied from the account (or prior period's closing) at start |
| `statement_closing_balance` | DECIMAL(18,2) NULL — typed in by the user from the real statement, required to close |
| `computed_closing_balance` | DECIMAL(18,2) NULL — HRMS running balance as of `to_date`, stored at close |
| `outstanding_total` | DECIMAL(18,2) NULL — sum of unmatched ledger entries dated ≤ `to_date`, stored at close |
| `closed_by` / `closed_at` | who/when closed |
| `reopened_by` / `reopened_at` / `reopen_reason` | most recent reopen, if any (mandatory reason) |

Constraint: a bank account cannot have two `open` periods at once (enforced in the service, not
a DB constraint — mirrors how `payment_voucher` enforces maker-checker in code, not SQL).

### `bank_statement_import` (new, sql/1709)
One row per upload.

| column | notes |
|---|---|
| `id` | CHAR(36) PK |
| `bank_account_id` | FK |
| `period_id` | FK `bank_reconciliation_period` |
| `original_filename` | VARCHAR |
| `column_mapping` | JSON — `{date, description, reference, debit, credit}` or `{date, description, reference, amount}` for single-signed-column banks |
| `imported_by` / `imported_at` | |
| `row_count` | INT |

The column mapping is also read back from an account's last import to pre-fill the mapping step
next time — no separate cache table needed, just "most recent import for this bank_account_id".

### `bank_statement_line` (new, sql/1710)
Each parsed row.

| column | notes |
|---|---|
| `id` | CHAR(36) PK |
| `import_id` | FK |
| `txn_date` | DATE |
| `description` | TEXT |
| `reference` | VARCHAR(100) NULL |
| `debit_amount` / `credit_amount` | DECIMAL(18,2) DEFAULT 0 |
| `match_status` | ENUM('unmatched','matched','adjusted') DEFAULT 'unmatched' |
| `matched_ledger_entry_id` | FK `bank_account_ledger_entry`, NULL |

### `bank_account_ledger_entry` additions (sql/1711, additive ALTER, guarded)
- `matched_statement_line_id` CHAR(36) NULL — set when matched to a statement row.
- `reconciliation_period_id` CHAR(36) NULL — set only at close. This is what "locks" an entry;
  no separate boolean needed.

## Matching engine

**Auto-match** (runs once per upload, before showing results):
- For each unmatched statement line: find `bank_account_ledger_entry` rows on the same
  `bank_account_id`, `matched_statement_line_id IS NULL`, exact amount match (debit line ↔
  `debit_amount`, credit line ↔ `credit_amount` — never fuzzy), `entry_date` within ±15 days of
  `txn_date` (configurable, covers cheque-clearing delay).
- Exactly one candidate → auto-matched, both rows updated in one transaction.
- Zero or multiple candidates → stays `unmatched`, surfaced for manual resolution (multiple
  shown as a picker — never silently guessed).

**Manual match**: user picks one line + one entry; server re-validates exact amount/type
equality before accepting — same guard as auto-match, never looser.

**Unmatch**: reversible any time before the period closes. Clears both FK links; nothing is
deleted.

**Adjustment entries** (bank-only items — charges, interest, RTGS fees): user picks the
statement line, a `payable_account_master` ledger head, and a narration. Posts a new
`bank_account_ledger_entry` with `source_type='reconciliation_adjustment'`, `voucher_id=NULL`,
running balance recomputed under the same `FOR UPDATE` row-lock `payment-voucher.service.ts`'s
`release()` already uses, then marks the statement line `matched_status='adjusted'` pointing at
the new entry. Logged via `logSensitiveAction`.

## Close / reopen

**Close preconditions** (all-or-nothing, checked server-side, not just UI-disabled):
1. No `bank_statement_line` for this period's import(s) is still `unmatched`.
2. `computed_closing_balance − outstanding_total === statement_closing_balance` exactly (the
   reconciliation formula). If it doesn't balance, close is refused and the exact difference is
   returned so the accountant can see what to investigate — never silently forced through.

**On close** (one transaction):
- `period.status='closed'`, stores `computed_closing_balance`/`outstanding_total`/`closed_by`/`closed_at`.
- Every ledger entry matched/adjusted under this period gets `reconciliation_period_id` set.
- `company_bank_account.opening_balance = statement_closing_balance`,
  `opening_balance_as_of = to_date` — carries forward as the next period's starting point (this
  is exactly what the 1701 migration's own comment already promised: "Reset by
  bank_reconciliation close in a later phase").
- Audited with the full balance breakdown.

**Reopen**: requires a mandatory reason. **Guarded**: refused if a *later* period (`from_date >
this.to_date`) for the same bank account is already `closed` — reopening an already-superseded
period would corrupt the forward opening-balance chain. On reopen: `status='open'`,
`reconciliation_period_id` cleared off its entries (frees them for re-match), reason/actor/time
recorded.

## Tally export — flipping `isFinal`

`tally-export.service.ts`'s `buildEnvelope` currently hardcodes `isFinal = false`. This phase
replaces that with: `isFinal = rows.length > 0 && every returned row's
reconciliation_period_id points to a period with status='closed'`. A range spanning both closed
and still-open periods stays provisional — never partially "final". Existing Phase 3 tests for
the always-false case are updated to reflect the new derivation; the sign-convention/TDS tests
are untouched.

## UI

Page: `/finance/bank-reconciliation` (new `page_code` `FINANCE_BANK_RECONCILIATION`, same role
gate pattern as 1707 — `accounts_head` gets create/edit/close, others view-only). Runs the
mandatory `ui-ux-pro-max` design search before implementation, per project rules.

- **Header**: bank account `SearchableSelect` (never free text) + period selector — pick an
  existing open period or "Start New Period" (from-date auto-filled the day after the last
  period's `to_date`).
- **Upload panel**: file input, upload → parses via saved/edited column mapping → auto-match
  runs immediately → summary ("42 of 50 auto-matched").
- **Unmatched Statement Lines** tab: each row has "Match" (candidate picker of nearby unmatched
  ledger entries) and "Post as Adjustment" (ledger-head dropdown + narration).
- **Outstanding HRMS Entries** panel: ledger entries in-period not yet matched (issued, not yet
  cleared) — read-only, feeds `outstanding_total`.
- **Reconciliation Summary** card: statement closing balance input, computed closing balance,
  outstanding total, live difference. "Close Period" disabled until difference is exactly zero
  and no unmatched lines remain.
- **History** tab: past periods for the account, row click → drill-down drawer per the project's
  Drill-Down Mandate (full period detail, match/unmatch counts, import metadata, close/reopen
  audit trail, link to that range's Tally export). Reopen action on the most recent closed
  period only, with a mandatory-reason confirm dialog.

## Testing

Backend unit tests (vitest, `db` mocked the same way `arrears-payment.service.test.ts` does):
- Statement parsing: column-mapping application for both debit/credit-pair and single-signed-
  amount layouts.
- Matching: single-candidate auto-match; ambiguous multi-candidate stays unmatched; date-window
  boundary; debit/credit type mismatch never matches; manual match re-validates and rejects
  mismatches; unmatch reversibility.
- Period close: blocked on remaining unmatched lines; blocked on non-zero balance difference
  (difference value asserted in the error); succeeds and sets `reconciliation_period_id` +
  carries `opening_balance` forward; reopen blocked when a later period is already closed;
  reopen succeeds, clears period id, requires a reason.
- Tally export: `isFinal` true only when every row's period is closed; mixed closed/open ranges
  stay provisional.

Manual/live verification per this project's mandatory pre-handover checklist: apply new
migrations to local DB, run tsc --noEmit clean on both sides, exercise the real endpoints with
curl/DB queries, confirm the new page renders and behaves against actual data before it's called
done.

## Out of scope (this phase)

- Multi-currency accounts (none exist in `company_bank_account` today).
- Automatic bank-feed/API ingestion (statement upload is manual, by design decision).
- Reconciling anything other than `bank_account_ledger_entry` (e.g. cash-in-hand) — company
  bank accounts only.
- Maker-checker on close (explicitly decided: single-owner Accounts Head workflow).
