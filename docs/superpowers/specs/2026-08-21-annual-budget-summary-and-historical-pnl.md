# Annual Budget Summary (multi-branch) + Historical P&L + GRN history — exploration & plan

Status: Draft for review — NOT approved, nothing built yet.
Date: 2026-08-21
Author: Claude (same session that found the grn_cost_allocation budget-consumption gap)

## 1. Why this came up

Investigating "why doesn't the branch budget page show August vendor/imprest spend"
surfaced two things:

1. A real, fixable bug: migrated GRNs never got a `grn_cost_allocation` row (separate
   fix, in progress — `backfill-grn-cost-allocation-clean-match.ts`).
2. A much bigger structural fact: **the native budget workspace
   (`finance_budget_header`/`finance_budget_line`) has only 5 rows across 4 branches**,
   covering Aug–Sep 2026 only. It cannot answer "what was FY2026-27's Annual Budget for
   all branches" today, because most branches simply have no budget entered in the new
   system yet.

The user's ask: since old budgets were also planned in db_bill, and expenses (GRN =
vendor + imprest) go back to 2017, can we build an **Annual Budget Summary for FY2026-27**
— single-branch and multi-branch/all-branch selectable — plus extend the same
budget-vs-actual thinking to **historical P&L for past months**, and to **GRN**.

## 2. What's actually available — confirmed live, not assumed

| Data | Table | Coverage confirmed live | Notes |
|---|---|---|---|
| Budget PLANNING, legacy | `db_bill.expense_master` | **FY2017-18 → FY2026-27**, 18,534 rows | The real long history. `ExpenseType='CostCenter'` is the correct filter (memory: `Particular` rows double the same amount as free text). |
| Budget PLANNING, mirrored into HRMS | `finance_budget_snapshot` / `finance_budget_line_snapshot` | period_code **2025-04 → 2027-01** only | Nightly-refreshed READ-ONLY mirror of `expense_master` (`sync-db-bill-snapshot.mjs`). Narrower than db_bill's true range — the sync's own `--from` default, not a hard limit. |
| Budget PLANNING, native (new system) | `finance_budget_header` / `finance_budget_line` | **5 headers, 4 branches, Aug–Sep 2026 only** | The "real" workspace the Branch Budget screen writes to. Effectively empty for FY2026-27 as a whole. |
| Expense ACTUALS (GRN = vendor + imprest + salary) | `grn_request` | **FY2017-18 → FY2026-27** (`accounting_period` 2017-04 → 2027-03), 84,788 rows | Full history, already migrated. `accounting_period` is the correct period column (memory: never `bill_date`). |
| Per-cost-centre/per-budget-line spend rollup | `grn_cost_allocation` | Only ~24 of 1,659 current-FY rows populated (the bug this session found) | Not usable historically either — this table is a *native-flow-only* concept; migrated GRNs never got one. **A historical report must NOT depend on this table.** |
| Existing precedent that already blends mirror + native | `backend/src/modules/process-pnl/ceo-overview.service.ts` | Single period at a time | Already resolves `branch_id` from cost-centre code, already reads `finance_budget_line_snapshot` for budget and `grn_request`/legacy invoice tables for actuals+revenue. This is the pattern to extend, not reinvent. |

**Key implication:** an Annual Budget Summary or historical P&L **cannot be built from
`finance_budget_header`/`grn_cost_allocation` alone** — those are near-empty for
anything before Aug 2026. It has to read the **mirror** (`finance_budget_snapshot`/
`finance_budget_line_snapshot`) for budget, and **`grn_request` directly** (not
`grn_cost_allocation`) for actuals, exactly the way `ceo-overview.service.ts` already
does for its one snapshot period. This is good news: the hard parts (sync, dedup,
Head-Office triple-count trap, head-id collision trap) are already solved there —
this is an extension of a working pattern, not new plumbing.

## 3. Proposed feature 1 — Annual Budget Summary (FY2026-27, branch or multi-branch)

**Shape:** for a selected financial year and one or more branches (or "all branches"),
show budget vs. actual per month (Apr–Mar), rolling up to an annual total, broken out by
head/sub-head, with a variance column.

**Data source per row:**
- Budget: `finance_budget_line_snapshot` (join `finance_budget_snapshot` for header-level
  fields), for months where `period_code` falls in 2025-04..2027-01 range. For any month
  outside that mirrored window, extend the sync's `--from` or add a targeted historical
  pull from `db_bill.expense_master` directly (read-only, same query shape the sync
  already uses) — a one-line config change to `sync-db-bill-snapshot.mjs`, not new code.
- Actual: `grn_request` grouped by `branch_id` + `accounting_period` + `head`/`sub_head`,
  `status NOT IN ('rejected','cancelled')` — matches the money in `grn-report.service.ts`'s
  existing Register report, so this stays consistent with what Finance already sees on
  the GRN Reports tab.

**Branch selection:** multi-select using the same `branch_master` list every other finance
screen uses (`useBranchList`-equivalent or `financeBranchFilter` helper already used across
`grn.service.ts`). "All branches" = no filter, grouped subtotals per branch + a grand total.

**API shape (proposed):**
`GET /api/finance/annual-budget-summary?financialYear=2026-27&branchIds=b1,b2&branchIds=all`
→ `{ branches: [{ branchId, branchName, months: [{periodCode, budget, actual, variance}], annualBudget, annualActual, annualVariance }], grandTotal: {...} }`

**UI:** new page or a new tab on the existing Branch Budget workspace
(`BranchBudgetManagementWorkspace.tsx` already has the `Metric` stat-tile pattern and
branch-scoping conventions to reuse) — a branch multi-select, a 12-month × head/sub-head
grid, collapsible by branch when "all branches" is selected, exportable as CSV (same
pattern as the client-billing CSV export shipped earlier today).

## 4. Proposed feature 2 — Historical P&L, any past month

The P&L module (`process-pnl`) already computes current-period P&L; `ceo-overview.service.ts`
already proves the mirror+GRN blend works for one period. The extension is:
- Accept `periodCode` as a real parameter (not implicitly "current") on the existing P&L
  read path, iterating it across a requested range.
- Same branch multi-select as feature 1, reusing the same resolved branch list.
- Same actual-vs-budget sourcing rule as feature 1 (mirror for budget pre-Sep-2026,
  native tables once a branch actually has a real budget entered there).

This is lower-risk than feature 1 because it's extending an existing, working, tested
service rather than building new aggregation from scratch — but it inherits feature 1's
data-source decision, so feature 1 should land first and feature 2 reuse its resolved
"budget-for-branch-and-month" building block rather than re-deriving it.

## 5. Proposed feature 3 — GRN historical view

`FinanceReportsWorkspace.tsx` / `grn-report.service.ts` (shipped 2026-08-20) already has a
Register report with Finance Month, ageing, unbudgeted flags, spanning the full history.
What it doesn't yet do: show budget-vs-actual side by side per branch/head, the way
features 1–2 will. Proposed: add a "Budget Coverage" column/mode to that existing report
using the same mirror-lookup helper features 1–2 build, rather than a new report — this
avoids a fourth place doing the same branch/period/head resolution differently.

## 6. Phasing (proposed)

1. **Finish the grn_cost_allocation backfill already in flight** (bucket ① from the budget-
   gap investigation) — independent, already approved, small.
2. **Build the shared "budget-for-branch-and-period" + "actual-for-branch-and-period"
   resolver** as its own service function, extracted from `ceo-overview.service.ts`'s
   inline logic — this is the piece every other feature here reuses. Verify it against
   `ceo-overview.service.ts`'s own already-correct output for at least one period, so the
   extraction is provably behavior-preserving before anything is built on top of it.
3. **Feature 1 (Annual Budget Summary)** — API + UI, single financial year, branch
   multi-select. Smallest complete slice; validates the resolver at scale (12 months ×
   many branches) before the other two features lean on it.
4. **Feature 2 (historical P&L)** — extend existing P&L read path to accept an arbitrary
   period, reusing the Phase 3 resolver.
5. **Feature 3 (GRN budget-coverage column)** — smallest increment, added to the existing
   Reports tab.

Each phase gets its own review checkpoint per CLAUDE.md's "one narrowly scoped phase at a
time" rule — this spec is not a green light to build all four in one pass.

## 7. Open questions before implementation starts

- **Mirror coverage gap (2017-04 → 2025-03):** extend `sync-db-bill-snapshot.mjs`'s
  `--from` to cover the full history (adds ~8 years × however many budget rows — likely
  fine at db_bill's 18,534-row scale), or leave older years reading `db_bill.expense_master`
  live on request? Recommend extending the sync — it is idempotent and already reconciled
  end-to-end; a live db_bill read on every report request would be slower and duplicate
  the trap-avoidance logic the sync already encodes.
- **What counts as "budget" once a branch DOES have a native FY2026-27 budget entered**
  (only 4 branches today, presumably growing) — does the Annual Summary switch that
  branch to `finance_budget_header`/`finance_budget_line` for the months it covers, or
  keep reading the mirror for consistency across the whole year? Recommend: prefer native
  where it exists for a given branch+month, fall back to mirror — same "prefer the real
  thing, mirror is a floor not a ceiling" principle already used elsewhere in this
  codebase (e.g. `billing_client_name` falling back to `company_name`).
- **Role/visibility scope** — Annual Budget Summary across "all branches" is more exposure
  than any single-branch screen; confirm which roles should see the all-branch rollup vs.
  only their own branch(es), likely narrower than `FINANCE_REPORT_ROLES`.

## 8. What this spec is NOT

Not a commitment to change how budgets are actually planned or consumed, not a change to
GRN approval logic, and not a replacement for the native `finance_budget_header`/
`finance_budget_line` workspace going forward — those stay the system of record for new
budgets. This is a reporting layer over data that already exists in two different places.
