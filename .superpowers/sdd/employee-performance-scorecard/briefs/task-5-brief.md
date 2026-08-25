# Task 5 Brief: Dashboard metric registry entries

Source plan: `docs/superpowers/plans/2026-08-25-employee-performance-scorecard.md` (Task 5)

## Prior task output you depend on

Task 6 (executed first, out of plan order, due to a dependency fix) created `backend/src/modules/dashboards/performance-scorecard-drilldown.ts`, which exports 8 tile-summary functions you will import here:
`getAttendanceStatusMetric`, `getLatecomingMetric`, `getUnplannedLeaveMetric`, `getPipStatusMetric`, `getQualityBaselineMetric`, `getAttritionMetric`, `getShrinkageMetric`, `getRevenueMetric`.

Note: the plan document originally described these as living in a separate file `performance-scorecard-metric-summaries.js` — that file does NOT exist. Import them from `./performance-scorecard-drilldown.js` instead (the actual file Task 6 created). Each returns a `MetricResult`-shaped stub with `status: "unknown"` (matching this codebase's existing `nullResult()` pattern in `dashboard-metric.service.ts`) — not the plan's originally-guessed `{ value: 0 }`.

## Task

**Files:**
- Modify: `backend/src/shared/dashboardAccessRegistry.ts`
- Modify: `backend/src/modules/dashboards/dashboard-definition.service.ts`

**Interfaces:**
- Consumes: the 8 tile-summary functions from `./performance-scorecard-drilldown.js` (Task 6).
- Produces: `DashboardCode` union member `PERFORMANCE_SCORECARD`, `MetricKey` union members for the 8 new metrics, `METRICS` entries for each, `DASHBOARD_METRICS.PERFORMANCE_SCORECARD` array — consumed by the route/frontend work in later tasks (not part of this task).

- [ ] **Step 1: Read both files first**

Read `backend/src/shared/dashboardAccessRegistry.ts` in full (it's small — the `DashboardCode` union) and read `backend/src/modules/dashboards/dashboard-definition.service.ts`'s `MetricKey` type, `METRICS` object, and `DASHBOARD_METRICS` object to confirm current exact structure and the last member of each (things may have shifted since the plan was written — other concurrent sessions may have added dashboards/metrics).

- [ ] **Step 2: Add the new `DashboardCode` member**

In `dashboardAccessRegistry.ts`, add `"PERFORMANCE_SCORECARD"` as a new member of the `DashboardCode` union (after whatever the current last member is — do not assume it's still `"EMPLOYEE_SELF_DASHBOARD"`, check).

- [ ] **Step 3: Add new `MetricKey` members**

In `dashboard-definition.service.ts`, extend the `MetricKey` union (after whatever the current last member is):
```ts
  | "attendanceStatus"
  | "latecoming"
  | "unplannedLeave"
  | "pipStatus"
  | "qualityBaseline"
  | "attrition"
  | "shrinkage"
  | "revenue";
```

- [ ] **Step 4: Add `METRICS` entries for each new key**

Add 8 entries to the `METRICS` object, following the exact shape of an existing entry (e.g. `leaveApprovals`) you find in Step 1:
```ts
attendanceStatus: { code: "ATTENDANCE_STATUS", label: "Attendance", unit: "days", source: "Attendance snapshot", sourceTable: "employee_performance_daily_snapshot", higherIsBetter: true, moduleCode: "performance-scorecard", execute: getAttendanceStatusMetric },
latecoming: { code: "LATECOMING", label: "Latecoming", unit: "minutes", source: "Attendance snapshot", sourceTable: "employee_performance_daily_snapshot", higherIsBetter: false, moduleCode: "performance-scorecard", execute: getLatecomingMetric },
unplannedLeave: { code: "UNPLANNED_LEAVE", label: "Unplanned Leave", unit: "days", source: "Attendance snapshot", sourceTable: "employee_performance_daily_snapshot", higherIsBetter: false, moduleCode: "performance-scorecard", execute: getUnplannedLeaveMetric },
pipStatus: { code: "PIP_STATUS", label: "PIP Status", unit: "status", source: "PIP records", sourceTable: "pip_record", higherIsBetter: true, moduleCode: "performance-scorecard", execute: getPipStatusMetric },
qualityBaseline: { code: "QUALITY_BASELINE", label: "Quality", unit: "score", source: "KPI daily actuals", sourceTable: "kpi_daily_actual", higherIsBetter: true, moduleCode: "performance-scorecard", execute: getQualityBaselineMetric },
attrition: { code: "ATTRITION", label: "Attrition", unit: "%", source: "Attrition analytics", sourceTable: "employee_performance_daily_snapshot", higherIsBetter: false, moduleCode: "performance-scorecard", execute: getAttritionMetric },
shrinkage: { code: "SHRINKAGE", label: "Shrinkage", unit: "%", source: "Shrinkage analytics", sourceTable: "employee_performance_daily_snapshot", higherIsBetter: false, moduleCode: "performance-scorecard", execute: getShrinkageMetric },
revenue: { code: "REVENUE", label: "Revenue", unit: "INR", source: "Finance/BI", sourceTable: "employee_performance_daily_snapshot", higherIsBetter: true, moduleCode: "performance-scorecard", execute: getRevenueMetric },
```
Add the import at the top of the file:
```ts
import {
  getAttendanceStatusMetric, getLatecomingMetric, getUnplannedLeaveMetric, getPipStatusMetric,
  getQualityBaselineMetric, getAttritionMetric, getShrinkageMetric, getRevenueMetric,
} from "./performance-scorecard-drilldown.js";
```
If the real `METRICS` entry shape found in Step 1 differs from the fields shown above (e.g. different field names), match the REAL shape, not this illustrative one — but keep `execute` pointed at the correct imported function for each metric.

- [ ] **Step 5: Add the `DASHBOARD_METRICS` entry**

```ts
PERFORMANCE_SCORECARD: [
  "attendanceStatus", "latecoming", "unplannedLeave", "pipStatus",
  "qualityBaseline", "attrition", "shrinkage", "revenue",
],
```

- [ ] **Step 6: Verify TypeScript compiles for the touched files**

Run a scoped `tsc` check against just the two touched files plus their dependency chain (not the full orphaned backend `tsc`, which has pre-existing unrelated errors per this repo's known convention) — e.g. `cd backend && npx tsc --noEmit src/shared/dashboardAccessRegistry.ts src/modules/dashboards/dashboard-definition.service.ts` and confirm no NEW errors were introduced (compare against what a clean checkout of these two files reports, if any pre-existing errors already existed).

- [ ] **Step 7: Run the existing dashboards test suite to confirm no regressions**

Run: `cd backend && npx vitest run src/modules/dashboards/__tests__/` — expect the same pass count Task 6 confirmed (22 files, 135 tests) with no new failures, since `DASHBOARD_METRICS`/`METRICS` are read by existing tests too.

- [ ] **Step 8: Commit**

```bash
git add backend/src/shared/dashboardAccessRegistry.ts backend/src/modules/dashboards/dashboard-definition.service.ts
git commit -m "feat: register PERFORMANCE_SCORECARD dashboard metrics"
```
Stage only these 2 explicit files. `git status --short` first, confirm nothing else is staged — these are hot, frequently-touched files.

## Report contract

Write your full report to `.superpowers/sdd/employee-performance-scorecard/reports/task-5-report.md`, then return ONLY:
- Status: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED
- Commit SHA(s)
- One-line verification summary
- Any concerns

## Important

- Do NOT push to GitHub. Commit locally to `main` only.
- This repo has concurrent sessions editing the shared tree. `git fetch` + re-check `git log` before committing; stage only the 2 listed files.
- Do not touch any file outside this task's file list.
- If you have questions before starting, ask them instead of guessing.
