# Task 6 Report: Drilldown handlers (executed before Task 5)

## Status: DONE

## What was built

Created `backend/src/modules/dashboards/performance-scorecard-drilldown.ts` with:
- 8 drilldown handlers: `drillAttendanceStatus`, `drillLatecoming`, `drillUnplannedLeave`,
  `drillPipStatus`, `drillQualityBaseline`, `drillAttrition`, `drillShrinkage`, `drillRevenue`.
  All except `drillPipStatus` read `employee_performance_daily_snapshot` (joined to `employees`)
  filtered by `employeeId`/`dateFrom`/`dateTo`, throwing an `Error` with `status: 400` attached
  if any of the three filters is missing. `drillPipStatus` reads `pip_record`/`pip_checkpoint`
  by `employeeId` only.
- 8 tile-summary stubs: `getAttendanceStatusMetric`, `getLatecomingMetric`,
  `getUnplannedLeaveMetric`, `getPipStatusMetric`, `getQualityBaselineMetric`,
  `getAttritionMetric`, `getShrinkageMetric`, `getRevenueMetric`. Each takes
  `(scope: DashboardScope)` and returns `Promise<MetricResult>` — the real type imported
  from `dashboard-metric.service.ts`, matching `MetricDefinition["execute"]` exactly (not
  the brief's placeholder `{ value: 0 }`). Stubs return the same shape as that file's own
  `nullResult()`: `value: null`, `status: "unknown"`, empty `detail`, no real query yet.

Modified `backend/src/modules/dashboards/dashboard-drilldown.service.ts`:
- Added one import block for the 8 handlers.
- Added 8 `case` branches to the `getDrilldown` switch, before `default:`, dispatching
  `ATTENDANCE_STATUS`, `LATECOMING`, `UNPLANNED_LEAVE`, `PIP_STATUS`, `QUALITY_BASELINE`,
  `ATTRITION`, `SHRINKAGE`, `REVENUE` to the new handlers.
- `export interface DrilldownResult` was already exported — no change needed.

Created `backend/src/modules/dashboards/__tests__/performance-scorecard-drilldown.test.ts`
using this repo's real Vitest pattern (`vi.hoisted` + `vi.mock("../../../db/mysql.js", ...)`,
matching `dashboard-drilldown-team-scope.test.ts`), covering `drillAttendanceStatus`:
one happy-path case (mocked `db.execute` row → one record with `attendanceStatus: "present"`)
and one missing-filter case (rejects).

## Step 1 findings (real types/paths, not the brief's placeholders)

- Real `db` import path: `"../../db/mysql.js"` (from `dashboard-drilldown.service.ts` itself).
- `DrilldownResult` is defined and already `export`ed in `dashboard-drilldown.service.ts`
  (`{ metricCode: string; records: unknown[]; note?: string; totalCount?: number }`).
- Handler first-param type used throughout the file is `DashboardScope` from
  `"../../shared/dashboardScope.js"`.
- `MetricDefinition["execute"]` in `dashboard-definition.service.ts` is
  `(scope: DashboardScope) => Promise<MetricResult>`, where `MetricResult` is exported from
  `dashboard-metric.service.ts` — a much richer shape than `{ value: 0 }`
  (`value, previousValue, target, variance, variancePct, changePct, status, trend,
  drilldownApi, actionUrl, detail, errorCode, errorMessage, sourceRowCount, asOf?`).
  The 8 stubs return this real shape, built from a local `stubMetricResult()` helper mirroring
  `dashboard-metric.service.ts`'s own `nullResult()`.

## Verification

- `npx vitest run src/modules/dashboards/__tests__/performance-scorecard-drilldown.test.ts`
  — failed first (module not found) before implementation, confirming the test was real;
  passed after (2/2) after implementation.
- `npx vitest run src/modules/dashboards/__tests__/` (all 22 dashboard test files, 135 tests)
  — all pass after the switch-wiring change; no regression in `dashboard-drilldown-team-scope.test.ts`
  or `dashboard-metric-code-contract.test.ts`.
- Targeted `tsc --noEmit` against just the two touched/created files reported no errors for
  either file (full-tree `tsc` is known-orphaned per project memory and was not used).
- `git show --stat HEAD` confirms exactly the 3 intended files landed in the commit, nothing else.

## Concerns

- `employee_performance_daily_snapshot` (Task 1's table) may not be applied to the live DB yet
  (known pre-existing deploy blocker, unrelated to this task). The 7 handlers that read it are
  correct against the migration's schema but untestable against live data until that table
  exists in the deployed DB.
- Tile-summary stubs are intentionally non-functional (`status: "unknown"`, `value: null`) per
  the brief — Task 5 will need to either wire real queries into them or accept they render as
  "no data" tiles until then.
- Not pushed to GitHub per instructions; committed locally to `main` only. Local `main` is
  behind `origin/main` (fetched `5d6d1a42` vs local base `a584d04a` before this commit) — this
  task did not attempt to merge/rebase since it was told to commit locally only and not push.
