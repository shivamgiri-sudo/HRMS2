# Performance Scorecard Rollup Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate the Employee Performance Scorecard's Attrition, Shrinkage, and Revenue columns with real values (currently hardcoded `null`), reusing existing services — no new calculation logic — and re-enable the frontend columns/chart series that were deliberately disabled while the data was fake.

**Architecture:** `computeEmployeeSnapshot` gains a manager-tier check (does this employee have direct reports?) and, if true, calls three existing services scoped by the manager's own `process_id`: `shrinkageService.listSnapshots` (daily, exact), `getDashboardSummary` (30-day rolling attrition), `getStatement` (monthly P&L revenue, extracting the `recognized_revenue` row). Individual contributors keep `null` for all three fields. Frontend flips `available: false` back to unset on the 3 columns and restores them as compare-chart series.

**Tech Stack:** Node/Express + TypeScript backend, MySQL, React + TypeScript frontend, Vitest.

## Global Constraints

- No new calculation logic — only call existing services (`shrinkageService.listSnapshots`, `getDashboardSummary`, `getStatement`).
- Manager-tier detection uses the dual-column check `reporting_manager_id OR manager_id` (matches the already-reviewed, established convention from `resolveDashboardScope`).
- Individual contributors (no direct reports) get `null` for all 3 fields — never a copy of their process's numbers.
- Attrition and Revenue are NOT true daily figures (30-day rolling and monthly P&L respectively) — this is accepted, documented behavior, not a bug to "fix" by faking daily granularity.
- Each of the 3 new service calls must degrade to `null` on its own failure (missing snapshot, service error, no data for period) without aborting the rest of `computeEmployeeSnapshot` — consistent with the function's existing null-default pattern.
- Do not modify `shrinkageService`, `getDashboardSummary`, or `getStatement` themselves — only call them.

---

## File Structure

**Modified:**
- `backend/src/modules/performance-scorecard/performance-scorecard-snapshot.service.ts` — add manager-tier detection + 3 service calls inside `computeEmployeeSnapshot`
- `src/components/performance-scorecard/performanceScorecardColumns.ts` — flip `available: false` → omitted on 3 columns
- `src/components/performance-scorecard/PerformanceCompareModal.tsx` — restore 3 metrics to `COMPARABLE_METRICS` and `chartData`

No new files.

---

### Task 1: Backend — populate real rollup metrics

**Files:**
- Modify: `backend/src/modules/performance-scorecard/performance-scorecard-snapshot.service.ts`
- Test: `backend/src/modules/performance-scorecard/__tests__/performance-scorecard-snapshot.service.test.ts`

**Interfaces:**
- Consumes: `shrinkageService.listSnapshots({fromDate, toDate, processId?, branchId?}): Promise<ShrinkageSnapshot[]>` from `../rta/rta.service.js` (field: `total_shrinkage_pct: number`); `getDashboardSummary(processId?: string, employeeIds?: string[])` from `./management.service.js`... actually from `../management/management.service.js` (returns `{ attrition_rate: number, ... }`, always a number, never null); `getStatement(filters: Partial<PnlQueryFilters>, viewBy: "process"): Promise<{ rows: StatementRow[], ... }>` from `../process-pnl/pnl-statement.service.js` (a `StatementRow` has `componentKey: string`, `values: Record<string, number | null>`; the revenue row has `componentKey === "recognized_revenue"`).
- Produces: `computeEmployeeSnapshot` now returns real (non-null) `teamAttritionPct`, `teamShrinkagePct`, `teamRevenue` for employees with direct reports — no signature change, same `Promise<EmployeePerformanceSnapshotRow>` return type.

- [ ] **Step 1: Read the current file and confirm exact export names**

Run: `grep -n "^export" backend/src/modules/management/management.service.ts backend/src/modules/process-pnl/pnl-statement.service.ts backend/src/modules/rta/rta.service.ts`
Confirm `getDashboardSummary` and `getStatement` are exported the way this plan assumes (as named exports, possibly also as methods on a `managementService`/`pnlStatementService` object — check both, use whichever the file's other exports already use as the import pattern elsewhere in the codebase). Adjust the import statements in Step 3 if the real export shape differs from this assumption.

- [ ] **Step 2: Write the failing test**

```ts
// Add to backend/src/modules/performance-scorecard/__tests__/performance-scorecard-snapshot.service.test.ts
// (this repo uses Vitest with vi.hoisted/vi.mock — match the existing file's mocking pattern for db,
// and add mocks for the 3 new service imports the same way)

it("populates real rollup metrics for an employee with direct reports", async () => {
  mockExecute
    .mockResolvedValueOnce([[{ attendance_status: "present", late_by_minutes: 0 }]]) // attendance
    .mockResolvedValueOnce([[]]) // active pip
    .mockResolvedValueOnce([[{ overall_score: 90 }]]) // quality
    .mockResolvedValueOnce([[{ designation_id: "desig-1" }]]) // designation
    .mockResolvedValueOnce([[{ has_reports: 1 }]]) // manager-tier check
    .mockResolvedValueOnce([[{ id: "report-1" }, { id: "report-2" }]]) // direct report ids
    .mockResolvedValueOnce([[{ process_id: "proc-1", branch_id: "branch-1" }]]); // manager's own scope

  mockListSnapshots.mockResolvedValueOnce([{ total_shrinkage_pct: 12.5 }]);
  mockGetDashboardSummary.mockResolvedValueOnce({ attrition_rate: 8.2 });
  mockGetStatement.mockResolvedValueOnce({
    rows: [{ componentKey: "recognized_revenue", values: { "proc-1": 500000 } }],
  });

  const result = await computeEmployeeSnapshot("mgr-1", "2026-08-24");

  expect(result.teamShrinkagePct).toBe(12.5);
  expect(result.teamAttritionPct).toBe(8.2);
  expect(result.teamRevenue).toBe(500000);
});

it("leaves rollup metrics null for an individual contributor with no direct reports", async () => {
  mockExecute
    .mockResolvedValueOnce([[{ attendance_status: "present", late_by_minutes: 0 }]])
    .mockResolvedValueOnce([[]])
    .mockResolvedValueOnce([[{ overall_score: 90 }]])
    .mockResolvedValueOnce([[{ designation_id: "desig-2" }]])
    .mockResolvedValueOnce([[{ has_reports: 0 }]]); // no direct reports

  const result = await computeEmployeeSnapshot("ic-1", "2026-08-24");

  expect(result.teamShrinkagePct).toBeNull();
  expect(result.teamAttritionPct).toBeNull();
  expect(result.teamRevenue).toBeNull();
  expect(mockListSnapshots).not.toHaveBeenCalled();
});

it("degrades a single rollup metric to null on that service's own failure, without affecting the others", async () => {
  mockExecute
    .mockResolvedValueOnce([[{ attendance_status: "present", late_by_minutes: 0 }]])
    .mockResolvedValueOnce([[]])
    .mockResolvedValueOnce([[{ overall_score: 90 }]])
    .mockResolvedValueOnce([[{ designation_id: "desig-1" }]])
    .mockResolvedValueOnce([[{ has_reports: 1 }]])
    .mockResolvedValueOnce([[{ id: "report-1" }]])
    .mockResolvedValueOnce([[{ process_id: "proc-1", branch_id: "branch-1" }]]);

  mockListSnapshots.mockRejectedValueOnce(new Error("db down"));
  mockGetDashboardSummary.mockResolvedValueOnce({ attrition_rate: 5.0 });
  mockGetStatement.mockResolvedValueOnce({ rows: [] }); // no recognized_revenue row for this period

  const result = await computeEmployeeSnapshot("mgr-2", "2026-08-24");

  expect(result.teamShrinkagePct).toBeNull(); // service threw
  expect(result.teamAttritionPct).toBe(5.0);   // succeeded
  expect(result.teamRevenue).toBeNull();       // no matching row, not an error
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npx vitest run performance-scorecard-snapshot.service.test.ts`
Expected: FAIL (mocks for `mockListSnapshots`/`mockGetDashboardSummary`/`mockGetStatement` don't exist yet, and `computeEmployeeSnapshot` doesn't call the new queries yet, so the extra `mockResolvedValueOnce` calls won't line up).

- [ ] **Step 4: Add the mock setup for the 3 new service imports**

At the top of the test file, alongside the existing `db` mock, add (matching the file's existing `vi.hoisted`/`vi.mock` pattern):
```ts
const mockListSnapshots = vi.hoisted(() => vi.fn());
const mockGetDashboardSummary = vi.hoisted(() => vi.fn());
const mockGetStatement = vi.hoisted(() => vi.fn());

vi.mock("../../rta/rta.service.js", () => ({
  shrinkageService: { listSnapshots: mockListSnapshots },
}));
vi.mock("../../management/management.service.js", () => ({
  getDashboardSummary: mockGetDashboardSummary,
}));
vi.mock("../../process-pnl/pnl-statement.service.js", () => ({
  getStatement: mockGetStatement,
}));
```
Adjust the mock shape (named export vs. object-method export) to match whatever Step 1 found the real export shape to be — if `getDashboardSummary`/`getStatement` are methods on a service object (like `shrinkageService`) rather than standalone named exports, mock them the same way as `shrinkageService` above.

- [ ] **Step 5: Implement the manager-tier check and 3 service calls**

In `performance-scorecard-snapshot.service.ts`, add the imports near the top:
```ts
import { shrinkageService } from "../rta/rta.service.js";
import { getDashboardSummary } from "../management/management.service.js";
import { getStatement } from "../process-pnl/pnl-statement.service.js";
```
(Adjust import paths/shapes per Step 1's findings if they differ.)

Inside `computeEmployeeSnapshot`, after the existing `emp` query (designation lookup) and before the `return` statement, add:
```ts
  const [[reportsCheck]] = (await db.execute(
    `SELECT EXISTS(
       SELECT 1 FROM employees WHERE reporting_manager_id = ? OR manager_id = ?
     ) AS has_reports`,
    [employeeId, employeeId],
  )) as any;

  let teamAttritionPct: number | null = null;
  let teamShrinkagePct: number | null = null;
  let teamRevenue: number | null = null;

  if (Number(reportsCheck?.has_reports) === 1) {
    const [reportRows] = (await db.execute(
      `SELECT id FROM employees WHERE reporting_manager_id = ? OR manager_id = ?`,
      [employeeId, employeeId],
    )) as any;
    const directReportIds = (reportRows as Array<{ id: string }>).map((r) => r.id);

    const [[managerScope]] = (await db.execute(
      `SELECT process_id, branch_id FROM employees WHERE id = ? LIMIT 1`,
      [employeeId],
    )) as any;
    const processId: string | undefined = managerScope?.process_id ?? undefined;
    const branchId: string | undefined = managerScope?.branch_id ?? undefined;

    try {
      const snapshots = await shrinkageService.listSnapshots({
        fromDate: date,
        toDate: date,
        processId,
        branchId,
      });
      if (snapshots.length > 0 && snapshots[0].total_shrinkage_pct !== null) {
        teamShrinkagePct = Number(snapshots[0].total_shrinkage_pct);
      }
    } catch (err) {
      console.error(`[performance-scorecard] shrinkage lookup failed for manager ${employeeId}`, err);
    }

    try {
      const summary = await getDashboardSummary(processId, directReportIds);
      if (summary?.attrition_rate !== undefined && summary.attrition_rate !== null) {
        teamAttritionPct = Number(summary.attrition_rate);
      }
    } catch (err) {
      console.error(`[performance-scorecard] attrition lookup failed for manager ${employeeId}`, err);
    }

    try {
      const period = date.slice(0, 7); // YYYY-MM
      const statement = await getStatement({ period, processId }, "process");
      const revenueRow = statement.rows.find((r: { componentKey: string }) => r.componentKey === "recognized_revenue");
      if (revenueRow) {
        const values = Object.values(revenueRow.values as Record<string, number | null>).filter(
          (v): v is number => v !== null,
        );
        if (values.length > 0) {
          teamRevenue = values.reduce((sum, v) => sum + v, 0);
        }
      }
    } catch (err) {
      console.error(`[performance-scorecard] revenue lookup failed for manager ${employeeId}`, err);
    }
  }
```

Then change the return object's 3 fields from hardcoded `null` to the computed variables:
```ts
    teamAttritionPct,
    teamShrinkagePct,
    teamRevenue,
```
(Keep `templateMetrics: null` unchanged — full KPI-role-template metrics remain out of scope per the design spec.)

- [ ] **Step 6: Run test to verify it passes**

Run: `cd backend && npx vitest run performance-scorecard-snapshot.service.test.ts`
Expected: PASS on all 3 new tests plus the existing tests in this file (do not let this change break the existing "unplanned_leave_flag" / "pip status" tests already in the file).

- [ ] **Step 7: Run the full performance-scorecard test suite**

Run: `cd backend && npx vitest run src/modules/performance-scorecard`
Expected: all files pass, no regressions in the route tests (they don't call `computeEmployeeSnapshot` directly, but confirm anyway).

- [ ] **Step 8: Commit**

```bash
git add backend/src/modules/performance-scorecard/performance-scorecard-snapshot.service.ts backend/src/modules/performance-scorecard/__tests__/performance-scorecard-snapshot.service.test.ts
git commit -m "feat: populate real attrition/shrinkage/revenue for manager-tier employees"
```
Stage only these 2 explicit files. This repo has concurrent sessions editing the shared tree — `git fetch` + re-check `git log` before committing, and confirm via `git status --short` that nothing else is staged.

---

### Task 2: Frontend — re-enable the 3 columns and compare-chart series

**Files:**
- Modify: `src/components/performance-scorecard/performanceScorecardColumns.ts`
- Modify: `src/components/performance-scorecard/PerformanceCompareModal.tsx`

**Interfaces:**
- Consumes: Task 1's backend now returning real (non-null, for manager-tier employees) `teamAttritionPct`, `teamShrinkagePct`, `teamRevenue` via the existing `GET /api/performance-scorecard` route — no API contract change, values just stop being always-null.

- [ ] **Step 1: Read the current files first**

Confirm the exact current content of both files matches what's documented in this task (they may have shifted since the last fix round) — read them before editing.

- [ ] **Step 2: Flip `available: false` on the 3 columns**

In `performanceScorecardColumns.ts`, change:
```ts
  { key: "teamAttritionPct", label: "Attrition", metricCode: "ATTRITION", format: (r) => (r.teamAttritionPct === null ? "—" : `${r.teamAttritionPct.toFixed(1)}%`), available: false },
  { key: "teamShrinkagePct", label: "Shrinkage", metricCode: "SHRINKAGE", format: (r) => (r.teamShrinkagePct === null ? "—" : `${r.teamShrinkagePct.toFixed(1)}%`), available: false },
  { key: "teamRevenue", label: "Revenue", metricCode: "REVENUE", format: (r) => (r.teamRevenue === null ? "—" : `₹${r.teamRevenue.toLocaleString("en-IN")}`), available: false },
```
to:
```ts
  { key: "teamAttritionPct", label: "Attrition", metricCode: "ATTRITION", format: (r) => (r.teamAttritionPct === null ? "N/A" : `${r.teamAttritionPct.toFixed(1)}%`) },
  { key: "teamShrinkagePct", label: "Shrinkage", metricCode: "SHRINKAGE", format: (r) => (r.teamShrinkagePct === null ? "N/A" : `${r.teamShrinkagePct.toFixed(1)}%`) },
  { key: "teamRevenue", label: "Revenue", metricCode: "REVENUE", format: (r) => (r.teamRevenue === null ? "N/A" : `₹${r.teamRevenue.toLocaleString("en-IN")}`) },
```
(Dropping `available: false` entirely rather than setting `available: true`, since the field defaults to `true` per its own JSDoc comment when omitted — and changing "—" to "N/A" for the null case, since null now means "individual contributor, not applicable" rather than "feature not built yet".)

`PerformanceScorecardTable.tsx` needs NO changes — its rendering is already driven generically by `col.available`, confirmed in research: once `available` is omitted/true, the drilldown-clickable branch renders automatically.

- [ ] **Step 3: Restore the 3 metrics in the compare panel**

In `PerformanceCompareModal.tsx`, change:
```tsx
// teamAttritionPct/teamShrinkagePct/teamRevenue are hardcoded null by the
// backend today (performance-scorecard-snapshot.service.ts — the KPI-role-
// template metric computation was never built), so they're deliberately
// excluded here — a selectable series that always plots a flat empty line
// would look like a broken chart rather than an unbuilt feature. Only
// lateByMinutes and qualityScore are real, populated per-row metrics.
const COMPARABLE_METRICS: Array<{ key: keyof ScorecardRow; label: string; color: string }> = [
  { key: "lateByMinutes", label: "Latecoming (min)", color: "#dc2626" },
  { key: "qualityScore", label: "Quality", color: "#15803d" },
];
```
to:
```tsx
const COMPARABLE_METRICS: Array<{ key: keyof ScorecardRow; label: string; color: string }> = [
  { key: "lateByMinutes", label: "Latecoming (min)", color: "#dc2626" },
  { key: "qualityScore", label: "Quality", color: "#15803d" },
  { key: "teamAttritionPct", label: "Attrition (%)", color: "#ea580c" },
  { key: "teamShrinkagePct", label: "Shrinkage (%)", color: "#6d28d9" },
];
```
And change the `chartData` mapping:
```tsx
const chartData = rows.map((r) => ({
  date: r.snapshotDate,
  lateByMinutes: r.lateByMinutes,
  qualityScore: r.qualityScore,
}));
```
to:
```tsx
const chartData = rows.map((r) => ({
  date: r.snapshotDate,
  lateByMinutes: r.lateByMinutes,
  qualityScore: r.qualityScore,
  teamAttritionPct: r.teamAttritionPct,
  teamShrinkagePct: r.teamShrinkagePct,
}));
```
(`teamRevenue` is deliberately NOT added to the compare chart — its values are orders of magnitude larger than the other 3 metrics, ~₹100,000s vs. single/double-digit percentages and minutes; plotting it on the same Y-axis would flatten the other lines to invisibility. Leave it as a table-only column, not a compare-chart series.)

- [ ] **Step 4: Verify it builds**

Run the real gate: `npm run typecheck` (both halves — `tsc -p tsconfig.app.json && tsc -p tsconfig.node.json`). Expect zero new errors from the 2 touched files.

- [ ] **Step 5: Commit**

```bash
git add src/components/performance-scorecard/performanceScorecardColumns.ts src/components/performance-scorecard/PerformanceCompareModal.tsx
git commit -m "feat: re-enable attrition/shrinkage/revenue columns and compare-chart series"
```
Stage only these 2 explicit files.

---

## Notes for the executing agent

- Do NOT push to GitHub — commit locally to `main` only, per this session's standing instruction.
- This repo has concurrent sessions editing the shared tree. `git fetch` + re-check `git log` before every commit; stage only the explicit files each task lists.
- Task 1's Step 1 (confirming real export shapes) may reveal that `getDashboardSummary`/`getStatement` are exported differently than this plan assumes (e.g. as object methods rather than standalone named exports, matching `shrinkageService`'s pattern) — adjust the import/mock/call syntax accordingly, the underlying logic doesn't change.
