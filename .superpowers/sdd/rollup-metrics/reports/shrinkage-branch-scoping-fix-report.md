# Shrinkage branch-scoping fix — report

Date: 2026-08-25

## Current behaviour (before this change)

- `rta-nightly.cron.ts::runRtaNightly()` called
  `shrinkageService.calculateSnapshot(date, { userId: SYSTEM_USER })` exactly
  once per night, with no `processId`/`branchId`. This produced one org-wide
  row per date in `shrinkage_daily_snapshot` with `process_id = NULL` and
  `branch_id = NULL`.
- `calculateSnapshot` already supports branch-scoped computation correctly
  when given a `branchId`: it resolves the id to `branch_master.branch_name`
  and filters `wfm_roster_assignment.branch_name` (see the comment block at
  `rta.service.ts` lines 324-332 explaining why the id column can't be
  filtered directly — `wfm_roster_assignment` has no `branch_id`/`process_id`
  columns, only `branch_name`/`process_name`). This is a working code path
  that was simply never invoked with scope.
- `performance-scorecard-snapshot.service.ts::computeEmployeeSnapshot` called
  `shrinkageService.listSnapshots({ fromDate, toDate, processId, branchId })`
  requiring an exact match on both `process_id` and `branch_id`. Since no
  snapshot row ever had a non-null `branch_id` or `process_id`, this always
  returned zero rows for any manager with real scope, so
  `teamShrinkagePct` was always `null`.
- `performanceScorecardColumns.ts` marked the Shrinkage column
  `available: false`, and `PerformanceScorecardTable.tsx` rendered a
  "Not yet available" badge with a shrinkage-specific tooltip instead of a
  clickable drilldown cell, to avoid the column looking broken/empty.

## Data verified (per the investigation already done, re-confirmed here)

- `shrinkage_daily_snapshot` unique key (from
  `backend/sql/021_attendance_leave_rta.sql`):
  `UNIQUE KEY uq_shr_date_proc (snapshot_date, process_id, branch_id)`.
- `calculateSnapshot` does an `INSERT ... ON DUPLICATE KEY UPDATE` — it is a
  genuine UPSERT, not insert-only. Re-running for the same
  `(date, processId, branchId)` is safe and does not create duplicate rows.
  Note (pre-existing, unrelated to this fix): MySQL unique indexes do not
  treat two rows with `NULL` in an indexed column as duplicates of each
  other, so in principle two org-wide calls (`process_id = NULL`,
  `branch_id = NULL`) for the same date are not guaranteed to collide at the
  DB level either — but the org-wide call already ran exactly once/night
  before this change and continues to do so; this fix does not touch that
  call's cardinality or add any new risk to it.
- Branch-scoped calls introduced here always pass a concrete non-null
  `branchId` (with `processId` still omitted/`NULL`), so each branch's rows
  are distinguished from each other and from the org-wide row purely by the
  non-null `branch_id` column — the NULL-uniqueness caveat above does not
  apply to them.
- `branch_master`'s "active" convention across this codebase is
  `active_status = 1` (confirmed via `access.routes.ts`,
  `payroll-branch-readiness.service.ts`, `management.service.ts`, etc.) —
  used for the new branch-listing query.
- No RTA test directory exists (`backend/src/modules/rta/__tests__` is
  absent); only `performance-scorecard`'s test dir exists and was run.

## Changes made

1. `backend/src/modules/rta/rta-nightly.cron.ts`
   - Added `SELECT id FROM branch_master WHERE active_status = 1` and, for
     each active branch, an additional
     `shrinkageService.calculateSnapshot(date, { branchId, userId: SYSTEM_USER })`
     call — **in addition to**, not replacing, the existing unscoped
     org-wide call.
   - Each branch's call is wrapped in its own try/catch (logged via
     `logger.error`, loop continues) so one branch's failure cannot abort
     the others or the org-wide call. The branch-listing query itself is
     also wrapped so a failure there degrades to "no branch snapshots
     tonight" rather than failing the whole nightly pipeline (reconciliation
     and alerts, which run before/after, are unaffected either way).
   - Process-level scoping was deliberately NOT added — `process_name` is
     NULL on ~81% of `wfm_roster_assignment` rows per the prior
     investigation, so it isn't safe to filter on yet.

2. `backend/src/modules/performance-scorecard/performance-scorecard-snapshot.service.ts`
   - `computeEmployeeSnapshot`'s shrinkage lookup now matches on `branchId`
     only (dropped `processId` from this one `listSnapshots` call). Added a
     one-line comment explaining why. The `processId` variable itself is
     untouched and still used by the attrition (`getDashboardSummary`) and
     revenue (`getStatement`) calls later in the same function.

3. `src/components/performance-scorecard/performanceScorecardColumns.ts`
   - Removed `available: false` from the Shrinkage column definition. Its
     null-case display was already `"N/A"` (matching Attrition/Revenue), so
     no format-string change was needed there.
   - Updated the `available` field's doc comment, which previously named
     Shrinkage as the running example of an unavailable column; it now notes
     no column currently uses `available: false` and explains why Shrinkage
     no longer does.

4. `src/components/performance-scorecard/PerformanceScorecardTable.tsx`
   - The `available === false` branch is now dead code (no column sets it),
     but left in place since the field/mechanism is still meant for a future
     gap. Genericized its tooltip text away from the now-stale
     Shrinkage-specific wording ("Shrinkage data isn't scoped by
     branch/process yet...") to a reusable line ("This metric isn't reliably
     scoped in the underlying system yet — it will show once that's
     fixed.").

## Risk assessment

- **Nightly cron runtime**: adds up to 4 extra `calculateSnapshot` calls
  (one per active branch), each running 2 aggregate queries over
  `attendance_reconciliation_record`/`wfm_roster_assignment` plus one
  upsert. Small, bounded addition (4 active branches today); not expected to
  meaningfully change the cron's runtime profile.
- **Duplicate rows**: none — covered by the UPSERT + unique-key analysis
  above.
- **Existing org-wide row**: untouched; still written first, unconditionally,
  exactly as before. Nothing about this change can prevent that call from
  running (it happens before the new branch loop and is not gated by it).
- **Performance-scorecard consumer**: dropping `processId` from this one
  `listSnapshots` call means a manager with a `branchId` but a different
  `processId` inside that branch will now see the *branch-wide* shrinkage
  figure as their team's shrinkage, not a process-level figure — this is
  intentional and matches the current grain of the underlying data (branch
  only), consistent with the task's Fix 2 instructions. If a manager has a
  `processId` but no `branchId` at all, `listSnapshots` is now called with
  `branchId: undefined`, which filters on date only and could match any
  branch's (or the org-wide) row for that date — this is an existing/edge
  behavior of `listSnapshots`'s filter-building, not newly introduced by
  this change (previously it would have matched zero rows in that case,
  since branch-scoped rows didn't exist yet); flagging it as a residual gap
  worth a future look, not fixed here per the task's stated scope (branch-
  only, minimal change).
- **Frontend**: Shrinkage column now renders as a normal clickable drilldown
  cell like Attrition/Revenue. No behavior change for employees whose
  manager has no branch scope — `teamShrinkagePct` stays `null` and displays
  `"N/A"`, same as before.

## Rollback

- Revert the 3 files via `git revert <this commit's SHA>` (or hand-revert):
  - `backend/src/modules/rta/rta-nightly.cron.ts` — remove the branch-loop
    block; the single unscoped `calculateSnapshot` call is untouched and
    continues working exactly as before revert.
  - `backend/src/modules/performance-scorecard/performance-scorecard-snapshot.service.ts`
    — restore `processId,` to the `listSnapshots` call.
  - `src/components/performance-scorecard/performanceScorecardColumns.ts` —
    restore `available: false` on the Shrinkage column.
  - (`PerformanceScorecardTable.tsx` tooltip text is cosmetic only; reverting
    it is optional and has no functional effect either way.)
- No migration was added or needed — `shrinkage_daily_snapshot`'s schema
  (including `process_id`/`branch_id` columns and the unique key) already
  existed and is unchanged by this fix.
- No data was backfilled or deleted. Rows already written by future nightly
  runs after this deploys (branch-scoped rows with non-null `branch_id`)
  are harmless to leave in place even after a code rollback — the org-wide
  `NULL`/`NULL` row remains the one every pre-existing caller other than the
  performance-scorecard was already reading.

## Verification performed

- `cd backend && npx vitest run src/modules/performance-scorecard` — real
  output: **14 tests passed, 2 test files, 0 failed.** (No
  `src/modules/rta/__tests__` directory exists, confirmed via `find`.)
- `npm run typecheck` (frontend, `tsc --noEmit -p tsconfig.app.json &&
  tsc --noEmit -p tsconfig.node.json`) — pre-existing errors in unrelated
  files (`OnboardingSteps1to5V2.tsx`, `AonAnalyticsView.tsx`,
  `useCostCentres.ts`, `NativeFullFinal.test.tsx`, `HrReferenceLayout.tsx`,
  `NativeIncentives.tsx`, `NativeOpsCommandCenter.tsx`,
  `NativeOrgMasters.tsx`, `EsiRegDocsTab.tsx`, `ProfileEnhanced*.tsx`,
  `RosterImportPage*.tsx`) — grepped output confirms **zero** errors
  mentioning `performance-scorecard` (the two files this task touched).
- Backend: `cd backend && npx tsc --noEmit -p tsconfig.json`, output grepped
  for `rta-nightly` and `performance-scorecard-snapshot` — **zero** matches
  (no errors in either touched backend file). Per project memory
  (`hrms2-backend-typecheck-orphans`), the full backend `tsc` run is known to
  surface unrelated pre-existing orphan errors, so this check was scoped to
  the touched files only rather than treating the full run's exit code as a
  gate.
- **No live DB write was performed.** Verification was done by static
  read-through of `calculateSnapshot`'s SQL, the `shrinkage_daily_snapshot`
  unique key from the migration SQL file, and the `branch_master.active_status`
  convention grepped from five other call sites in the codebase — not by
  invoking the cron or `calculateSnapshot` against the live database. This
  is a shared production cron; per the task's own guidance, a real branch
  write was judged unnecessary since the UPSERT/unique-key/active-branch
  logic was fully verifiable by static inspection, and it will run for real,
  and be observable via its logs, on the next scheduled nightly run
  (23:15 IST) without any manual trigger from this task.

## Concerns to flag

- The pre-existing NULL/NULL uniqueness nuance on the org-wide row (see
  "Data verified" above) is not a regression introduced here, but is a
  latent characteristic of the schema worth someone's attention separately
  if the org-wide call is ever parallelized or retried.
- The `listSnapshots({ branchId: undefined })` edge case for a
  process-only manager (no `branchId` on their employee record) is
  flagged above under Risk assessment as a residual gap, deliberately left
  as-is per the task's branch-only scope.
