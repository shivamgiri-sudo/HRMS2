# Task 6 Brief: Drilldown handlers (executed BEFORE Task 5 — see note below)

Source plan: `docs/superpowers/plans/2026-08-25-employee-performance-scorecard.md` (Task 6)

## Execution order note

The plan lists this as Task 6, after Task 5 (dashboard metric registry). That ordering is WRONG — Task 5 imports summary functions from the file this task creates, but this task's switch-wiring does not depend on Task 5 at all (the `getDrilldown` switch dispatches purely on a `metricCode` string, unrelated to the `DASHBOARD_METRICS` registry Task 5 edits). So this task (plan's "Task 6") is being executed FIRST, and Task 5 will follow, importing from what you produce here. Proceed with this task as if it were self-contained — it is.

## Prior task output you depend on

None from this plan (Tasks 1-4 are unrelated backend infra). This task only touches existing, already-live dashboard drilldown infrastructure plus the new `employee_performance_daily_snapshot` table (Task 1 — table exists in the repo's migration manifest; note it may not be applied to the live DB yet, a known pre-existing deploy blocker unrelated to your work — your code should be correct regardless of whether the table has data yet).

## Task

**Files:**
- Create: `backend/src/modules/dashboards/performance-scorecard-drilldown.ts`
- Modify: `backend/src/modules/dashboards/dashboard-drilldown.service.ts`
- Test: `backend/src/modules/dashboards/__tests__/performance-scorecard-drilldown.test.ts`

**Interfaces:**
- Consumes: `DrilldownResult` type and the DB client import used elsewhere in `dashboard-drilldown.service.ts` (read that file first to find the exact `db` import path and the `DashboardScope` type it uses for handler signatures — match them, do not guess).
- Produces (all consumed by a LATER task, Task 5, which will import them — keep these exact names):
  - Drilldown handlers: `drillAttendanceStatus`, `drillLatecoming`, `drillUnplannedLeave`, `drillPipStatus`, `drillQualityBaseline`, `drillAttrition`, `drillShrinkage`, `drillRevenue`
  - Tile-summary stubs: `getAttendanceStatusMetric`, `getLatecomingMetric`, `getUnplannedLeaveMetric`, `getPipStatusMetric`, `getQualityBaselineMetric`, `getAttritionMetric`, `getShrinkageMetric`, `getRevenueMetric`

- [ ] **Step 1: Read `dashboard-drilldown.service.ts` first**

Before writing anything, read the full file to find: (a) its exact `db` import path, (b) the `DrilldownResult` interface (should already be exported — confirm), (c) the `DashboardScope` type used by existing handler functions' first parameter, (d) one full existing handler (e.g. `drillLeaveApprovals`) as your style reference, (e) the `getDrilldown` function's switch statement so you know exactly where to insert new cases.

Also read `backend/src/modules/dashboards/dashboard-definition.service.ts`'s `MetricDefinition` type (specifically its `execute` field's return type) so your tile-summary stubs in Step 2 return a value of the correct shape — do not guess this, read the actual type.

- [ ] **Step 2: Write the failing test for one handler (ATTENDANCE_STATUS)**

Use this repo's real test framework — check an existing test file under `backend/src/modules/dashboards/__tests__/` (if one exists) or elsewhere in the codebase for the exact mocking pattern (this repo uses Vitest with `vi.hoisted`/`vi.mock`, not Jest — confirmed in a prior task's review). Adapt this example accordingly:

```ts
// backend/src/modules/dashboards/__tests__/performance-scorecard-drilldown.test.ts
// (illustrative structure — adapt mocking syntax to this repo's real Vitest pattern)
describe("drillAttendanceStatus", () => {
  it("returns one record per snapshot day with attendanceStatus and lateByMinutes", async () => {
    // mock db.execute to return one row: { employeeCode: "E100", employeeName: "Test User",
    //   snapshotDate: "2026-08-24", attendanceStatus: "present", lateByMinutes: 5 }
    const result = await drillAttendanceStatus({} as any, { employeeId: "emp-1", dateFrom: "2026-08-01", dateTo: "2026-08-24" });
    expect(result.metricCode).toBe("ATTENDANCE_STATUS");
    expect(result.records).toHaveLength(1);
    expect((result.records[0] as any).attendanceStatus).toBe("present");
  });

  it("throws a 400-flagged error when employeeId, dateFrom, or dateTo is missing", async () => {
    await expect(drillAttendanceStatus({} as any, { employeeId: "emp-1" })).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run the test file with this repo's real vitest invocation. Expected: FAIL because the module doesn't exist yet.

- [ ] **Step 4: Write the implementation**

```ts
// backend/src/modules/dashboards/performance-scorecard-drilldown.ts
import { db } from "PLACEHOLDER_CONFIRM_REAL_PATH_FROM_STEP_1.js";
import type { DrilldownResult } from "./dashboard-drilldown.service.js";

interface ScorecardFilters {
  employeeId?: string;
  dateFrom?: string;
  dateTo?: string;
}

function requireRange(filters: Record<string, unknown> | undefined): { employeeId: string; dateFrom: string; dateTo: string } {
  const f = (filters ?? {}) as ScorecardFilters;
  if (!f.employeeId || !f.dateFrom || !f.dateTo) {
    throw Object.assign(new Error("employeeId, dateFrom and dateTo are required"), { status: 400 });
  }
  return { employeeId: f.employeeId, dateFrom: f.dateFrom, dateTo: f.dateTo };
}

async function fetchSnapshotRows(employeeId: string, dateFrom: string, dateTo: string) {
  const [rows] = (await db.execute(
    `SELECT e.employee_code AS employeeCode, e.full_name AS employeeName,
            s.snapshot_date AS snapshotDate, s.attendance_status AS attendanceStatus,
            s.late_by_minutes AS lateByMinutes, s.unplanned_leave_flag AS unplannedLeaveFlag,
            s.pip_status AS pipStatus, s.quality_score AS qualityScore,
            s.team_attrition_pct AS teamAttritionPct, s.team_shrinkage_pct AS teamShrinkagePct,
            s.team_revenue AS teamRevenue
       FROM employee_performance_daily_snapshot s
       JOIN employees e ON e.id = s.employee_id
      WHERE s.employee_id = ? AND s.snapshot_date BETWEEN ? AND ?
      ORDER BY s.snapshot_date ASC`,
    [employeeId, dateFrom, dateTo],
  )) as any;
  return rows as Array<Record<string, unknown>>;
}

export async function drillAttendanceStatus(_scope: unknown, filters?: Record<string, unknown>): Promise<DrilldownResult> {
  const { employeeId, dateFrom, dateTo } = requireRange(filters);
  const rows = await fetchSnapshotRows(employeeId, dateFrom, dateTo);
  return { metricCode: "ATTENDANCE_STATUS", records: rows.map((r) => ({ employeeCode: r.employeeCode, employeeName: r.employeeName, snapshotDate: r.snapshotDate, attendanceStatus: r.attendanceStatus })), totalCount: rows.length };
}

export async function drillLatecoming(_scope: unknown, filters?: Record<string, unknown>): Promise<DrilldownResult> {
  const { employeeId, dateFrom, dateTo } = requireRange(filters);
  const rows = await fetchSnapshotRows(employeeId, dateFrom, dateTo);
  return { metricCode: "LATECOMING", records: rows.map((r) => ({ employeeCode: r.employeeCode, employeeName: r.employeeName, snapshotDate: r.snapshotDate, lateByMinutes: Number(r.lateByMinutes ?? 0) })), totalCount: rows.length };
}

export async function drillUnplannedLeave(_scope: unknown, filters?: Record<string, unknown>): Promise<DrilldownResult> {
  const { employeeId, dateFrom, dateTo } = requireRange(filters);
  const rows = (await fetchSnapshotRows(employeeId, dateFrom, dateTo)).filter((r) => Boolean(r.unplannedLeaveFlag));
  return { metricCode: "UNPLANNED_LEAVE", records: rows.map((r) => ({ employeeCode: r.employeeCode, employeeName: r.employeeName, snapshotDate: r.snapshotDate, attendanceStatus: r.attendanceStatus })), totalCount: rows.length };
}

export async function drillPipStatus(_scope: unknown, filters?: Record<string, unknown>): Promise<DrilldownResult> {
  const { employeeId } = requireRange(filters);
  const [rows] = (await db.execute(
    `SELECT pr.status, pr.start_date, pr.end_date, pr.reason, pc.checkpoint_date, pc.rating, pc.notes
       FROM pip_record pr LEFT JOIN pip_checkpoint pc ON pc.pip_id = pr.id
      WHERE pr.employee_id = ? ORDER BY pr.start_date DESC, pc.checkpoint_date DESC LIMIT 100`,
    [employeeId],
  )) as any;
  return { metricCode: "PIP_STATUS", records: rows, totalCount: rows.length };
}

export async function drillQualityBaseline(_scope: unknown, filters?: Record<string, unknown>): Promise<DrilldownResult> {
  const { employeeId, dateFrom, dateTo } = requireRange(filters);
  const rows = await fetchSnapshotRows(employeeId, dateFrom, dateTo);
  return { metricCode: "QUALITY_BASELINE", records: rows.map((r) => ({ employeeCode: r.employeeCode, employeeName: r.employeeName, snapshotDate: r.snapshotDate, qualityScore: r.qualityScore === null ? null : Number(r.qualityScore) })), totalCount: rows.length };
}

export async function drillAttrition(_scope: unknown, filters?: Record<string, unknown>): Promise<DrilldownResult> {
  const { employeeId, dateFrom, dateTo } = requireRange(filters);
  const rows = await fetchSnapshotRows(employeeId, dateFrom, dateTo);
  return { metricCode: "ATTRITION", records: rows.map((r) => ({ employeeCode: r.employeeCode, snapshotDate: r.snapshotDate, teamAttritionPct: r.teamAttritionPct === null ? null : Number(r.teamAttritionPct) })), totalCount: rows.length, note: "Team-level rollup for this employee's managed team" };
}

export async function drillShrinkage(_scope: unknown, filters?: Record<string, unknown>): Promise<DrilldownResult> {
  const { employeeId, dateFrom, dateTo } = requireRange(filters);
  const rows = await fetchSnapshotRows(employeeId, dateFrom, dateTo);
  return { metricCode: "SHRINKAGE", records: rows.map((r) => ({ employeeCode: r.employeeCode, snapshotDate: r.snapshotDate, teamShrinkagePct: r.teamShrinkagePct === null ? null : Number(r.teamShrinkagePct) })), totalCount: rows.length, note: "Team-level rollup for this employee's managed team" };
}

export async function drillRevenue(_scope: unknown, filters?: Record<string, unknown>): Promise<DrilldownResult> {
  const { employeeId, dateFrom, dateTo } = requireRange(filters);
  const rows = await fetchSnapshotRows(employeeId, dateFrom, dateTo);
  return { metricCode: "REVENUE", records: rows.map((r) => ({ employeeCode: r.employeeCode, snapshotDate: r.snapshotDate, teamRevenue: r.teamRevenue === null ? null : Number(r.teamRevenue) })), totalCount: rows.length, note: "Team-level rollup for this employee's managed team" };
}

// Tile-summary stubs for dashboard-definition.service.ts's METRICS entries (consumed by the NEXT task, Task 5).
// CONFIRM the exact return shape of MetricDefinition["execute"] in dashboard-definition.service.ts (Step 1) and
// match it exactly here — do not guess { value: 0 }, use whatever the real type requires.
export async function getAttendanceStatusMetric() { return { value: 0 }; }
export async function getLatecomingMetric() { return { value: 0 }; }
export async function getUnplannedLeaveMetric() { return { value: 0 }; }
export async function getPipStatusMetric() { return { value: 0 }; }
export async function getQualityBaselineMetric() { return { value: 0 }; }
export async function getAttritionMetric() { return { value: 0 }; }
export async function getShrinkageMetric() { return { value: 0 }; }
export async function getRevenueMetric() { return { value: 0 }; }
```
Replace the `PLACEHOLDER_CONFIRM_REAL_PATH_FROM_STEP_1.js` import with the real db import path found in Step 1. Adjust the tile-summary stub return shape to match the real `MetricDefinition["execute"]` type if it differs from `{ value: 0 }`.

- [ ] **Step 5: Wire the 8 cases into `getDrilldown`**

In `dashboard-drilldown.service.ts`, add the import at the top:
```ts
import {
  drillAttendanceStatus, drillLatecoming, drillUnplannedLeave, drillPipStatus,
  drillQualityBaseline, drillAttrition, drillShrinkage, drillRevenue,
} from "./performance-scorecard-drilldown.js";
```
And add these cases to the `switch (metricCode)` block, before `default:`:
```ts
    case "ATTENDANCE_STATUS":
      return drillAttendanceStatus(scope, filters);
    case "LATECOMING":
      return drillLatecoming(scope, filters);
    case "UNPLANNED_LEAVE":
      return drillUnplannedLeave(scope, filters);
    case "PIP_STATUS":
      return drillPipStatus(scope, filters);
    case "QUALITY_BASELINE":
      return drillQualityBaseline(scope, filters);
    case "ATTRITION":
      return drillAttrition(scope, filters);
    case "SHRINKAGE":
      return drillShrinkage(scope, filters);
    case "REVENUE":
      return drillRevenue(scope, filters);
```
Confirm `export interface DrilldownResult` is already exported from this file (it should be, per existing code) — if it's not currently exported, add `export` to it (this is a minimal, safe addition, not a behavior change).

- [ ] **Step 6: Run test to verify it passes**

Expected: PASS on both test cases.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/dashboards/performance-scorecard-drilldown.ts backend/src/modules/dashboards/dashboard-drilldown.service.ts backend/src/modules/dashboards/__tests__/performance-scorecard-drilldown.test.ts
git commit -m "feat: add performance scorecard drilldown handlers"
```
`dashboard-drilldown.service.ts` is a hot, frequently-touched file — re-read its current tail immediately before editing, and confirm via `git status --short` that only these 3 files are staged before committing (do not stage the whole file blindly if `git status` shows unrelated changes in it from another session).

## Report contract

Write your full report to `.superpowers/sdd/employee-performance-scorecard/reports/task-6-report.md`, then return ONLY:
- Status: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED
- Commit SHA(s)
- One-line test/verification summary
- Any concerns

## Important

- Do NOT push to GitHub. Commit locally to `main` only.
- This repo has concurrent sessions editing the shared tree, including `dashboard-drilldown.service.ts` which is touched by many features. `git fetch` + re-check `git log` before committing; stage only the 3 listed files.
- Do not touch any file outside this task's file list.
- If you have questions before starting (especially about the real db import path or the MetricDefinition execute return type), ask them instead of guessing.
