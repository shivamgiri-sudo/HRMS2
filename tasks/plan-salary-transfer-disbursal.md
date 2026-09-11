# Implementation Plan: Ready-for-Disbursal / Disbursed split for Salary Transfer

Note on filename: the shared `tasks/plan.md`/`tasks/todo.md` convention already held another
concurrent session's active "Role Page RBAC Cleanup" plan when this was written — overwriting
it once, by accident, and restoring it immediately. Using a distinct filename for this feature
from here on to avoid a repeat collision in this multi-session repo.

## Overview

User's exact requirement: when the Salary Transfer File is generated, those employees should be
visible in a **"Ready for Disbursal"** view. When the **Transfer Number Update File** is
uploaded, it should match against that ready set by employee code. Matches move to a
**"Disbursed"** view. Non-matches stay in **"Ready for Disbursal"**, and from there payroll adds
a **failure reason** — reusing the rejection-reason mechanism already built.

## What already existed (confirmed live, 2026-09-11)

The state-machine logic was already built and already correct in
`backend/src/modules/payroll/salary-transfer.service.ts`: `exported` (file generated) →
(matched by Transfer Number Update File) → `confirmed`; unmatched items are left completely
untouched (still `exported`); `rejectTransferItems()` already writes a real failure reason from
the exact legacy wording payroll uses. Nothing in that transition logic needed to change.

The real file in the Downloads folder (`Transfer number update file.csv`) was checked directly
against the parser: header `EmpCode,EmpName,ECSNumber,TRF Date,Branch`, dates like `7-May-26`
(single-digit day) — matches `parseTransferNumberCsv`/`parseTrfDate` exactly as already
implemented. No parser changes were needed.

## What was missing, and what was built

Purely presentation — the items table was one flat list with a raw status badge.

1. **Backend** (`bank-payment-readiness.routes.ts`, `GET /salary-transfer/items`): added a
   server-derived `bucket` field per row — `exported`/`corrected_ready` → `ready_for_disbursal`,
   `confirmed` → `disbursed`, `rejected` → `rejected` — so the frontend never re-implements this
   mapping. Verified against live data (2,600 `exported` → `ready_for_disbursal`, 1 `rejected`
   → `rejected`, 0 `confirmed` yet).
2. **Frontend** (`PaymentDisbursalCenter.tsx`): replaced the single flat items table with three
   labeled, collapsible sections (Ready for Disbursal / Disbursed / Rejected), each with a live
   count. The Ready for Disbursal section gained a "Select all" control plus an "Add failure
   reason for N" button, so after uploading a Transfer Number Update File payroll can select
   everyone still sitting there (i.e., everyone whose code was not in the file) and add a reason
   in one action, reusing the *existing* reject dialog/endpoint — no new backend route.

## Non-goal, flagged explicitly

The separate **"Disbursal" tab** on the same page (`salary_run_disbursal` table,
`disbursal.routes.ts`) is a distinct, older manual cheque/NEFT-reference log, unrelated to
`salary_transfer_batch_item`. This work does not touch it.

## Status

- [x] Task 1: `bucket` field on `GET /salary-transfer/items` — done, typechecked, live-verified
- [x] Task 2: Three-section items view — done, typechecked
- [x] Task 3 (simplified from the original plan): in-context bulk "add failure reason" via
      Select-all + button on the Ready for Disbursal section, rather than a separate
      import-result screen — achieves the same acceptance criteria with less new state, since
      the Ready for Disbursal section *is*, at all times, exactly "everyone whose data hasn't
      come through a transfer number file yet"
- [ ] Task 4: Browser end-to-end verification against a real run with a real partial-match CSV
      upload — pending, next step
- [ ] Push to origin — blocked, see the standing git-push-blocker note reported separately
