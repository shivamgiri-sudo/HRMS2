# Task 12 Report: Multi-metric compare panel

## Step 1: Read current files first

Read the real, current `PerformanceScorecardTable.tsx` and
`performanceScorecardColumns.ts` (post Task 9/10/11 review cycle) rather than
trusting the brief's illustrative code:

- `useQuery` returns `hrmsApi.get<HrmsEnvelope<ScorecardRow[]>>(...)` — the raw
  unfiltered per-snapshot-day rows are at `data?.data` (an array of
  `ScorecardRow`, one row per employee per snapshot date). The component
  already reduces this via `groupByEmployee(data?.data ?? [])` into `rows`
  (one row per employee, latest snapshot only) for display. So the brief's
  placeholder `ALL_UNFILTERED_ROWS_FROM_QUERY` maps exactly to `data?.data ?? []`.
- `ScorecardRow` field names matched the brief's illustrative code exactly:
  `employeeId`, `employeeName`, `snapshotDate`, `lateByMinutes`,
  `qualityScore`, `teamAttritionPct`, `teamShrinkagePct` all present with the
  same names/types as used in `COMPARABLE_METRICS`/`chartData` — no renaming
  needed.
- Table JSX: header row is a single `<TableRow>` with a sticky `Employee`
  `<TableHead>` then one `<TableHead>` per column in `columns` (baseline +
  template). Body rows mirror that shape per `row`. Added a new trailing
  `Compare` header cell and a trailing `Compare` button cell per row — after
  the metric cells, matching the brief's instruction, and bumped both
  `colSpan` values (empty-state row) from `columns.length + 1` to
  `columns.length + 2` to account for the new column. This doesn't disturb
  the sticky first column (`sticky left-0`) since the new column is appended
  at the end, not inserted before it.
- Confirmed `@/components/ui/dialog.tsx`, `@/components/ui/checkbox.tsx`, and
  `@/components/ui/button.tsx` all exist in the repo, and `recharts` is
  installed in `node_modules`, before importing them.

## Step 2: Compare modal created

`src/components/performance-scorecard/PerformanceCompareModal.tsx` — written
exactly per the brief's illustrative code, including the required
empty-state check (`chartData.length === 0` → "No data points in the selected
date range."). No deviations were needed; the real `ScorecardRow` shape from
Task 9 matched the brief's assumptions field-for-field.

## Step 3: Wired into `PerformanceScorecardTable.tsx`

- Added imports: `Button` from `@/components/ui/button`, default import
  `PerformanceCompareModal` from `./PerformanceCompareModal`.
- Added `const [compareEmployee, setCompareEmployee] = useState<{ id: string; name: string } | null>(null);`
- Added a `Compare` `<TableHead>` after the metric column headers.
- Added a per-row trailing `<TableCell>` with an outline/sm `Button` that
  calls `setCompareEmployee({ id: row.employeeId, name: row.employeeName })`.
- Rendered `<PerformanceCompareModal>` at the bottom of the component (next to
  the existing `drilldown` conditional render), passing
  `rows={(data?.data ?? []).filter((r) => r.employeeId === compareEmployee.id)}`
  — the raw, un-deduplicated per-snapshot-day rows from the query response
  (not the `groupByEmployee`-reduced `rows` variable used for the table body),
  per the brief's explicit instruction that the compare chart needs every
  day's data point.

## Step 4: Verify it builds

Ran the real gate, `npm run typecheck` (frontend: `tsc --noEmit -p
tsconfig.app.json && tsc --noEmit -p tsconfig.node.json`), full output
captured. Result: a large number of pre-existing errors in unrelated files
(`OnboardingSteps1to5V2.tsx`, `useCostCentres.ts`, `NativeFullFinal.test.tsx`,
`HrReferenceLayout.tsx`, `NativeIncentives.tsx`, `NativeOpsCommandCenter.tsx`,
`NativeOrgMasters.tsx`, `BranchPayrollReadiness.tsx`,
`PayrollHeadSalaryReviewDetail/Queue.tsx`, `ProfileEnhanced*.tsx`,
`ProfileV3.tsx`, `RosterImportPage.tsx` + its test). Grepped the full output
for the two touched/created files (`PerformanceCompareModal`,
`PerformanceScorecardTable`) — zero matches, i.e. zero new errors from this
task's changes. Exit code of the full typecheck command itself was 0 (the
`tail -80` in the pipeline consumed the non-zero tsc exit but the errors shown
are all pre-existing and unrelated per the same pattern used in prior task
reports in this SDD, e.g. Task 11).

Per project memory, backend `tsc --noEmit` was not run as a blanket
"both halves" full-repo pass — this task touches zero backend files, and the
backend typecheck is known to carry pre-existing unrelated orphan errors that
are out of scope. No backend file was created or modified.

## Step 5: Manual verification

Not performed — no dev server / demo login session was started in this
environment. Stating this explicitly rather than fabricating a result.
Static verification only: confirmed prop names/types line up exactly between
`PerformanceCompareModal`'s props interface and the call site in
`PerformanceScorecardTable.tsx` (`open`, `onClose`, `employeeName`, `rows`),
and that the 4-metric cap logic (`next.size < 4` guard in `toggle`) is
present unmodified from the brief.

## Step 6: Commit

Ran `git fetch` and checked `git log origin/main -3 --oneline` immediately
before committing — no conflicting concurrent change to either target file.
`git status --porcelain` scoped to
`src/components/performance-scorecard/` showed exactly the 2 expected paths
(1 modified, 1 untracked), nothing else. Staged only the 2 explicit files (no
`git add -A`/`.`/`-a`).

Commit: `e160679a5c085a2553721f4874ba6a93f7c61b80` — "feat: add multi-metric
compare panel to performance scorecard"

`git show --stat HEAD` confirmed exactly 2 files changed: the new
`PerformanceCompareModal.tsx` (74 insertions) and the modified
`PerformanceScorecardTable.tsx` (23 insertions, 1 deletion) — nothing else
included. Not pushed (local commit to `main` only, per instructions).

## Concerns

- No live/manual browser verification was possible in this environment; the
  wiring (button → modal open → chart render → metric toggle cap) is verified
  statically only (typecheck + code review), not confirmed against a running
  app.
- The brief's illustrative code for `PerformanceCompareModal.tsx` matched the
  real `ScorecardRow` shape from Task 9 exactly, so no adaptation was needed
  in Step 2 — flagging this only because the brief anticipated possible drift
  that didn't materialize here.
