# Vendor Payment Dispatch — UI Upgrade + Logic Fixes

Date: 2026-09-10
Status: Approved for planning

## Problem

`src/pages/finance/VendorPaymentDispatchPage.tsx` is functionally live (14,371
rows in `vendor_payment_tracking`, real dispatch/hold/installment-proof flow
via `PaymentDispatchSheet`), but the list/landing page has real UX and logic
defects, not just a dated look:

1. **Misleading empty state.** The grid shows "No payments found" for the
   current month even when the real cause is upstream: a GRN only reaches
   `vendor_payment_tracking` after clearing all three approval stages
   (`branch_head_approved` → `finance_head_approved` → `approved`, see
   `backend/src/modules/finance/grn.service.ts:1080-1150`). As of this audit,
   99 GRNs since August are stuck mid-pipeline (41 at branch-head, 58 at
   finance-head) versus only 2 that reached this page for September. The page
   gives zero visibility into that backlog.
2. **Misleading scope.** `readScope` capability distinguishes
   `"organisation"` vs `"branch"`, but the UI badge just says "branch scope"
   without naming which branch(es), and the "All branches" filter option is
   silently overridden server-side for branch-scoped roles
   (`resolveFinanceBranchScopeSet`, `finance-access-scope.ts:118-139`).
3. **Two date dimensions, unlabeled.** The main grid filters on
   `vpt.due_date`; the Vendor Ledger sub-panel on the same page renders
   `accounting_period`. They can legitimately disagree for the same invoice
   with no on-screen explanation.
4. **Dead filter capability.** Backend list/export routes accept
   `financialYear` (`vendor-payment.routes.ts:169-171`); the frontend
   `Filters` interface never sends it.
5. **Visual inconsistency with sibling Finance pages.** Every other upgraded
   Finance page (`UnlinkedGrnReviewPage.tsx`, `AnnualBudgetSummaryPage.tsx`,
   `BranchBudgetManagementWorkspace.tsx`) uses a shared `Metric` tile recipe
   for its KPI strip (`rounded-2xl border p-4`, uppercase tracked label, bold
   value). This page still uses plain inline `<span>` text for the same data.

## Non-goals

- Not fixing *why* GRNs stall in approval (stale approvers, missing
  notifications, etc.) — that's the GRN approval workflow, a different
  surface, out of scope per explicit user decision.
- Not touching `PaymentDispatchSheet` (drawer) — audited, already solid.
- No schema changes, no changes to the installment-ledger dispatch/hold
  endpoints.

## Design

### Backend (small, additive)

New route: `GET /api/finance/vendor-payments/pending-approval-summary`
(`vendor-payment.routes.ts`, same `PAYMENT_READ_ROLES` gate as the existing
capabilities/list routes).

New service function `getPendingApprovalSummary()` in
`vendor-payment.service.ts`: queries `grn_request` for rows in
`branch_head_approved`/`finance_head_approved` status, grouped by branch and
stage, with count + `SUM(amount_with_tax)`. Reuses the existing
`resolveFinanceBranchScopeSet` scope helper from `finance-access-scope.ts` —
same branch narrowing as every other endpoint on this page, no new RBAC
surface.

Capabilities route (`GET /vendor-payments/capabilities`) response gains one
field: `scopeBranchNames: string[]` (resolved branch names when
`readScope === "branch"`, empty/omitted when `"organisation"`) so the frontend
can render an honest badge instead of the generic "branch scope" label.

### Frontend (`VendorPaymentDispatchPage.tsx`)

1. **KPI strip → `Metric` tile grid.** Local `Metric` component (not a shared
   import — none exists in Finance today, matches established per-page
   pattern), `grid grid-cols-2 md:grid-cols-5 gap-2`. Tiles: Page Due, Paid,
   Balance, Overdue (existing four sums, now as tiles), plus new **Pending
   Approval** tile (amber tone) sourced from the new endpoint.

2. **Approval Backlog panel.** New `showBacklog` toggle button in the header,
   same family as the existing `showAging`/`showLedger` toggles. Panel lists
   branch × stage counts/amounts from the new endpoint, each row linking to
   the existing GRN approval page (no new write actions here).

3. **Honest empty state.** When `rows.length === 0`:
   - If the backlog summary has any GRNs: render "No payments due for
     dispatch — N GRNs (₹X) are still awaiting approval before they reach
     this queue." with a link to open the Approval Backlog panel.
   - Else: keep the current plain "No payments found for these filters."

4. **Honest scope badge.** Replace the generic `{capabilities.readScope}
   scope` pill with the resolved branch name(s) when scope is `"branch"`
   (e.g. "Karnal only"); keep "organisation scope" as-is when global.

5. **`financialYear` filter.** Add to the `Filters` interface and the filter
   bar as a `Select` (closed set — the repo's dropdown-over-free-text rule),
   options built from the real distinct years present in the data (query via
   the existing list/aging endpoints' response or a small distinct-years
   fetch), not hardcoded.

6. **Inline overdue chip.** Due-date column gets a small "N days overdue"
   chip when `agingDays(due_date) > 0` and status isn't Paid/Closed — reuses
   the `agingDays()` helper already in the file, no new query.

7. **Ledger period tooltip.** Small info affordance on the Ledger panel's
   "Period" column header noting it reflects `accounting_period`, which can
   differ from the grid's `due_date` filter.

Everything else (Aging panel, existing Ledger table, export, pagination,
filter bar mechanics, `STATUS_CLASS` palette, dense row/header sizing) is
kept as-is — those already match the rest of the app and aren't broken.

## Testing / verification

- `npm run build` and `cd backend && npx tsc --noEmit` clean.
- New endpoint hit directly with `curl` against a real token; counts checked
  against `SELECT status, COUNT(*), SUM(amount_with_tax) FROM grn_request
  WHERE status IN ('branch_head_approved','finance_head_approved') GROUP BY
  status` on `mas_hrms` (expect the ~41/58 split confirmed by this audit,
  drifting as approvals move).
- Visual check in a real browser (chrome-devtools) for: empty-state message
  with the actual current backlog numbers, KPI tile rendering, backlog panel
  open/close, financialYear filter round-tripping into the query string,
  branch-scoped badge (verify against a branch_head test login if available).
