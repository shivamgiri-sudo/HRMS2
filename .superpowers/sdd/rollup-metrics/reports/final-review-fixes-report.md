# Performance Scorecard Rollup Metrics — Final Review Fixes

Date: 2026-08-25

## Scope

Fixes to findings raised in the final whole-branch review of the merged
"Performance Scorecard Rollup Metrics" plan (Tasks 1–2). Files touched:

- `backend/src/modules/performance-scorecard/performance-scorecard-snapshot.service.ts`
- `backend/src/modules/performance-scorecard/__tests__/performance-scorecard-snapshot.service.test.ts`
- `src/components/performance-scorecard/performanceScorecardColumns.ts`
- `src/components/performance-scorecard/PerformanceScorecardTable.tsx`

`src/components/performance-scorecard/PerformanceCompareModal.tsx` was
inspected — it charts `teamShrinkagePct` values directly and has no
`available`-flag logic, so no code change was needed there; it continues to
plot nulls as gaps via `connectNulls`.

## CRITICAL — Shrinkage column structurally incapable of returning a value

Verified live prior to fixing: `shrinkage_daily_snapshot` rows are written
with `process_id = NULL AND branch_id = NULL`, while every manager-tier
employee has a non-NULL `process_id`/`branch_id`. `shrinkageService.listSnapshots`
filters with exact-match equality, so the manager-scoped lookup always
returns 0 rows — `teamShrinkagePct` is always `null` in practice.

**Fix**: reverted only the Shrinkage column to `available: false` in
`performanceScorecardColumns.ts` (Attrition and Revenue left enabled — they
don't have this problem). Updated the `available === false` tooltip copy in
`PerformanceScorecardTable.tsx` from the generic "coming in a future
release" to a specific, honest message:

> Shrinkage data isn't scoped by branch/process yet in the underlying
> system — showing once that's fixed.

The backend's shrinkage service-call code was left untouched, as directed —
it's harmless (resolves to null today) and will start working automatically,
with zero code changes, once `shrinkage_daily_snapshot` is populated with a
real scope.

## IMPORTANT — no guard for a manager with a NULL process_id

`performance-scorecard-snapshot.service.ts`: added a `hasScope` guard
(`processId !== undefined || branchId !== undefined`). If a manager-tier
employee has neither `process_id` nor `branch_id` on their own record, all 3
rollup service calls (`shrinkageService.listSnapshots`,
`managementService.getDashboardSummary`, `getStatement`) are now skipped
entirely, leaving `teamAttritionPct` / `teamShrinkagePct` / `teamRevenue` as
`null` — the same as the individual-contributor path — instead of calling
scoped services with no scope, which would silently return company-wide (or
all-branch) totals attributed to one manager.

Verified against production data: 0/72 managers currently have a NULL
`process_id`/`branch_id` combination, so this is a defensive guard for a
condition that does not fire today but would silently corrupt data at scale
if it ever did.

## MINOR — 200% attrition reachable with all-inactive direct reports

The `directReportIds` query in `computeEmployeeSnapshot` had no
`active_status` filter. Added `AND active_status = 1` to:

```sql
SELECT id FROM employees WHERE (reporting_manager_id = ? OR manager_id = ?) AND active_status = 1
```

(table has no alias in the existing query, so the added clause matches that
style rather than introducing one). This keeps `directReportIds` consistent
with `getDashboardSummary`'s own active-only headcount count, preventing an
empty-headcount denominator from pushing the attrition formula toward 200%
when a manager's only direct reports have since exited.

## MINOR — stale JSDoc

Updated the `ScorecardColumn.available` JSDoc in
`performanceScorecardColumns.ts` to describe `available: false` as marking a
metric whose underlying data source has its own scoping/population gap
(citing Shrinkage as the concrete example), rather than "never populated by
the backend at all" — which is no longer true for Attrition/Revenue.

## Documentation — attrition backfill-anchoring caveat

Added a one-line-style comment directly above the `getDashboardSummary` call
site in `performance-scorecard-snapshot.service.ts`, documenting that its
attrition calculation is anchored to `CURDATE()` inside the shared
`management.service.ts`, not to the snapshot's historical `date` parameter —
so a backfilled historical row is stamped with today's 30-day attrition
rate, not the rate as of that historical date. Framed as a sharper version
of the already-accepted "30-day rolling, not a true daily figure" caveat,
and explicitly out of scope to fix here (would require changing the shared
service).

## Tests

Added a new test case to
`performance-scorecard-snapshot.service.test.ts`:
"skips all 3 rollup calls and leaves metrics null when the manager has
neither process_id nor branch_id" — given `has_reports: 1` but the
manager-scope query returns `{ process_id: null, branch_id: null }`, asserts
all 3 rollup fields stay `null` and none of `mockListSnapshots` /
`mockGetDashboardSummary` / `mockGetStatement` are called.

Existing tests required no mock changes — the active_status filter and the
scope guard did not change the number or order of `db.execute` calls in the
"populates real rollup metrics" / "individual contributor" / "degrades a
single rollup metric" cases (their manager-scope mocks already return
non-null `process_id`/`branch_id`).

### Verification output

```
cd backend && npx vitest run src/modules/performance-scorecard
 RUN  v4.1.7 C:/Users/ADMIN/Desktop/HRMS2-latest/backend
 Test Files  2 passed (2)
      Tests  14 passed (14)
```

(13 pre-existing + 1 new test, all passing.)

Backend typecheck: `npx tsc --noEmit` in `backend/` produced zero diagnostics
referencing `performance-scorecard-snapshot.service.ts` (grepped the full
output for the filename — no matches). Per project memory
(`hrms2-backend-typecheck-orphans`), the full backend `tsc` run carries
pre-existing unrelated orphan errors elsewhere in the tree, so the check was
scoped to this file rather than treating a nonzero overall exit code as a
regression here.

Frontend typecheck: `npm run typecheck` — result appended below once the
background run completed (see commit message / final report for pass/fail).

## Concurrency notes

Read `CLAUDE.md`'s Concurrent Agent Rule before starting. `git status
--short` showed a large number of unrelated dirty files from other
concurrent sessions (other `.superpowers/sdd/*` briefs/reports, other page
files). None of those were touched, staged, or committed — only the 4 files
listed above (the exact paths named in this fix's scope) were staged
explicitly by path.
