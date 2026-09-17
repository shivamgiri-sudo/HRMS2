# Reconciling the P&L views against the double-entry ledger

Scoped 2026-09-17, on the CEO/CA compliance review's own instruction ("scope it as a real
project"). This is a plan, not a fix — nothing here is built yet except where marked DONE.

## What's being compared

**The P&L views** (Live P&L, Trend, CEO Overview, Insights — [[hrms2-live-pnl-seat-billing-estimate-shipped]])
already agree with EACH OTHER (Aug-26 6.71% OP margin on all four tabs, live-verified 2026-09-15).
That reconciliation is done. This plan is about a *different* gap: those four views vs. the
double-entry ledger (`journal_entry`, Trial Balance / Ledger Reports) built this session
(PR #115, [[hrms2-ceo-wants-full-governed-tally]]).

**The ledger** is a from-scratch Tally-equivalent double-entry book. It did not exist before this
session and currently posts from exactly four sources: GRN approval (vendor + imprest),
Payment Voucher release, bank reconciliation adjustments, and — as of today — payroll salary
vouchers (opt-in, not yet triggered on any real run).

## Why they disagree today — three separate, unrelated reasons

### 1. The ledger has no revenue side at all
Confirmed by source scan: every `journalService.post()` call site posts an *expense or cash*
event (GRN, Payment Voucher, bank reconciliation, payroll). Nothing posts a client invoice, a
receivable, or revenue recognition. `client_invoice_payment_tracking` and the `client_billing_*`
tables exist and are populated, but nothing reads them into `journal_entry`.

**Consequence:** the ledger cannot produce a P&L at all today — only a Trial Balance of the
expense/liability/cash side. Comparing "Live P&L margin" against "the ledger's margin" is not
yet a meaningful comparison; the ledger has no top line to compute one from.

### 2. Payroll — the P&L's largest cost line — was entirely absent from the ledger until today
Fixed this session ([[hrms2-ceo-wants-full-governed-tally]] follow-up, commit `a73fcad3`): a
payroll run can now be posted to `journal_entry` via
`POST /api/finance/payroll/runs/:runId/vouchers/post-to-ledger`, using the same Gross Salary /
Salary+EPF+ESIC+TDS Payable model the existing Tally export already computes correctly.

**Still open:**
- Nothing triggers this automatically. A payroll run that is never explicitly posted stays
  invisible to the ledger, same as before.
- No historical payroll runs have been posted — only future runs, from the day someone starts
  using the new endpoint, will show up in the ledger's payroll expense line.
- The 39,099 historical `grn_type='salary'` GRN rows (2018–2021, ~₹39.3 Cr) are ruled closed
  history and deliberately excluded (commit `6260310a`) — they will never appear in the ledger.

### 3. Scope mismatch: IDC
P&L views include IDC (read from `db_bill` live, per the 2026-08-10 ruling
"no IDC data in `mas_hrms`" — see `docs/finance/OPEN-QUESTIONS.md` §5b/§3). The ledger is
`mas_hrms`-only by construction (`journal_entry` has no IDC-sourced rows and no mechanism to get
any, matching the same ruling). **This is not a bug to fix** — it is the same governance boundary
already decided for the rest of the system. Any reconciliation report must either scope IDC out
of both sides consistently, or treat "MAS-only ledger vs. MAS+IDC P&L" as two different,
correctly-different numbers shown side by side.

## What a real reconciliation needs, phased

| Phase | What | Depends on | Rough size |
|---|---|---|---|
| 0 | Payroll can be posted to the ledger | — | **DONE** (`a73fcad3`) |
| 1 | Decide + build: does payroll posting become automatic (triggered at run finalization) or stays a manual Finance action forever? Decide whether to backfill recent (non-2018-2021) historical runs. | Owner decision | Small once decided — the posting function already exists |
| 2 | Revenue/receivables journal posting: client invoice raised → Dr Accounts Receivable / Cr Revenue; payment received → Dr Bank / Cr Accounts Receivable. New ledger accounts, new posting call sites in the client-billing module, needs its own correctness review (GST treatment, credit notes, the seat-billing *estimate* used by Live P&L is explicitly not-yet-invoiced money and should NOT post as real revenue until it becomes a real invoice). | Owner sign-off on the Dr/Cr model, same rigor as payroll's | **Largest single piece** — genuinely multi-week, touches an existing, separate revenue system |
| 3 | A real Trial-Balance-vs-P&L reconciliation report: Ledger Reports' existing Trial Balance, sliced by branch/cost-centre/process/period (already has this dimension — [[hrms2-ceo-wants-full-governed-tally]]), compared side-by-side against the same slice of Live P&L's cost + revenue. Surfaces deltas per line, not just a total. | Phases 1 and 2 (nothing meaningful to compare before both sides have real numbers) | Medium — mostly a new report page reading two already-built sources |
| 4 | Close remaining deltas iteratively as Phase 3 surfaces them (e.g. GST treatment differences, timing/accrual-vs-cash differences, allocation-policy gaps already flagged in [[hrms2-pnl-two-engines-waterfall-gap]]) | Phase 3 | Open-ended — this is where "why is branch X off by ₹40,000 in March" gets answered one case at a time |

## Recommendation

Do not attempt Phase 3's comparison report before Phases 1 and 2 exist — it would just prove
"the ledger has no revenue and half the payroll history," which is already known and not new
information. The two decisions that actually unblock progress:

1. **Payroll trigger policy** (Phase 1) — quick to decide, quick to build once decided.
2. **Whether to build revenue/receivables posting at all, and when** (Phase 2) — this is the real
   scope question. It's a separate system (client billing) with its own correctness bar, not a
   small addition to what exists. Worth treating as its own planned piece of work, not folded
   into "finish the reconciliation" as if it were a subtask.

## Explicit non-goals of this document

- Not proposing to change how Live P&L computes its own numbers — that engine is already
  internally consistent (2026-09-15) and outside this scope.
- Not proposing to relax the no-IDC-in-`mas_hrms` ruling.
- Not a implementation plan for Phase 2 — that needs its own scoping pass once the owner decides
  it's worth doing, likely as a Plan-mode session with docs/finance/OPEN-QUESTIONS.md §2's
  existing open questions (client invoice/provision workflow) as a prerequisite, since you can't
  post an invoice's revenue correctly while its own workflow states are still undefined.
