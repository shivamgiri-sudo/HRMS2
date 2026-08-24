# Employee Performance Scorecard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every employee a single scorecard row (Attendance, Latecoming, Unplanned Leave, PIP status, plus role-template metrics like Quality/Attrition/Shrinkage/Revenue), filterable by date range, with per-metric drill-down and a multi-metric compare panel — visible to Reporting Managers (own team), HR/Ops (branch/process scope), and CEO (org-wide), via the existing RBAC scope system.

**Architecture:** A nightly scheduler aggregates each employee's daily metrics into a new `employee_performance_daily_snapshot` table (mirrors the existing `dashboard-snapshot.cron.ts` pattern). A new RBAC-scoped `GET /api/performance-scorecard` route reads that table for a date range. Drill-down reuses the existing generic `DashboardDrilldownDrawer` — new work is 8 backend metric registrations under a new `PERFORMANCE_SCORECARD` dashboard code. Frontend: one shared `PerformanceScorecardTable` component used both inside the existing `TeamPerformanceTab` (managers) and a new `PerformanceCommandCenter` page (HR/Ops/CEO).

**Tech Stack:** Node/Express + TypeScript backend, MySQL (mysql2), React + TypeScript + Vite frontend, TanStack Query, shadcn/ui + Tailwind, recharts.

## Global Constraints

- Never modify payroll/salary calculation logic (out of scope entirely for this feature).
- New tables with a FK-like column to `employees(id)` must use an explicit `COLLATE` matching `employees.id`'s actual collation (known repo pitfall — verify via `SHOW CREATE TABLE employees` before writing the migration, do not assume).
- New scheduled workers must be registered in **both** `backend/src/server.ts` and `backend/src/workers/all-workers.ts` (known repo pitfall — a worker registered in only one never runs).
- `hrmsApi` callers always pass paths starting with `/api/...` regardless of environment (the client strips the prefix internally when needed) — a path without the prefix silently 200s with the SPA shell instead of erroring.
- Manager-scoping uses `employees.reporting_manager_id` (not the separate `employees.manager_id` column) — this matches the existing, already-audited `isManagerOf` guard in `career.service.ts` used by PIP. Do not introduce a second manager-resolution rule.
- Unplanned leave, for this feature, is defined as `attendance_daily_record.attendance_status IN ('absent', 'missing_punch')` for a given day — this mirrors the existing project ruling that an unresolved `missing_punch` is unpaid/unplanned (do not invent a different definition).
- All new pages must be gated with `WorkforcePageGate` + a `pageCode` that has real `page_catalog`/`role_page_access` rows — a `pageCode` with no catalog row makes the gate deny everyone.
- Migration numbers continue from **1558** (highest existing is `1557_branch_sal_code_from_db_bill.sql`).

---

## File Structure

**Backend — new:**
- `backend/sql/1558_employee_performance_daily_snapshot.sql` — new table
- `backend/sql/1559_performance_scorecard_page_catalog.sql` — page_catalog/role_page_access seed rows
- `backend/src/modules/performance-scorecard/performance-scorecard.types.ts` — shared types
- `backend/src/modules/performance-scorecard/performance-scorecard-snapshot.service.ts` — aggregation logic
- `backend/src/modules/performance-scorecard/performance-scorecard-snapshot.cron.ts` — scheduler (mirrors `dashboard-snapshot.cron.ts`)
- `backend/src/modules/performance-scorecard/performance-scorecard.routes.ts` — `GET /api/performance-scorecard`
- `backend/src/modules/dashboards/performance-scorecard-drilldown.ts` — 8 drill handlers (kept out of the already-large `dashboard-drilldown.service.ts`, imported into its switch)
- `backend/scripts/backfill-performance-scorecard-snapshot.ts` — one-time historical backfill

**Backend — modified:**
- `backend/src/shared/dashboardAccessRegistry.ts` — add `PERFORMANCE_SCORECARD` to `DashboardCode`
- `backend/src/modules/dashboards/dashboard-definition.service.ts` — add metric keys + `DASHBOARD_METRICS` entry
- `backend/src/modules/dashboards/dashboard-drilldown.service.ts` — 8 new `case`s delegating to the new file
- `backend/src/server.ts` — register new cron scheduler
- `backend/src/workers/all-workers.ts` — register new cron scheduler (start + stop)
- Route mount file (wherever other `/api/...` routers are mounted, same place `management.routes.ts` is mounted) — mount `performance-scorecard.routes.ts`

**Frontend — new:**
- `src/components/performance-scorecard/PerformanceScorecardTable.tsx` — shared table
- `src/components/performance-scorecard/PerformanceCompareModal.tsx` — compare panel
- `src/pages/PerformanceCommandCenter.tsx` — new page for HR/Ops/CEO

**Frontend — modified:**
- `src/components/my-team/TeamPerformanceTab.tsx` — use `PerformanceScorecardTable` instead of its local table
- `src/config/routes/performance.routes.tsx` — new route
- `src/components/layout/navConfig.tsx` — new nav entry

---

### Task 1: Snapshot table migration

**Files:**
- Create: `backend/sql/1558_employee_performance_daily_snapshot.sql`
- Modify: `backend/src/db/runPendingMigrations.ts` (register the migration, following the existing registration pattern used for `1252_kpi_role_template_metrics.sql`)

**Interfaces:**
- Produces: table `employee_performance_daily_snapshot` with columns consumed by Task 2 (`performance-scorecard-snapshot.service.ts`) and Task 6 (`performance-scorecard.routes.ts`).

- [ ] **Step 1: Verify `employees.id` collation**

Run against the live DB (read-only):
```sql
SHOW CREATE TABLE employees;
```
Note the exact `COLLATE` on the `id` column (e.g. `utf8mb4_unicode_ci` or `utf8mb4_general_ci`) — use that exact value in Step 2. Do not assume.

- [ ] **Step 2: Write the migration**

```sql
-- backend/sql/1558_employee_performance_daily_snapshot.sql
CREATE TABLE IF NOT EXISTS employee_performance_daily_snapshot (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  employee_id VARCHAR(36) NOT NULL COLLATE utf8mb4_unicode_ci, -- match employees.id collation from Step 1
  snapshot_date DATE NOT NULL,
  attendance_status VARCHAR(20) NULL,
  late_by_minutes INT NOT NULL DEFAULT 0,
  unplanned_leave_flag TINYINT(1) NOT NULL DEFAULT 0,
  pip_status VARCHAR(20) NULL,
  designation_id VARCHAR(36) NULL,
  quality_score DECIMAL(6,2) NULL,
  template_metrics JSON NULL,
  team_attrition_pct DECIMAL(6,2) NULL,
  team_shrinkage_pct DECIMAL(6,2) NULL,
  team_revenue DECIMAL(18,2) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_emp_perf_snapshot (employee_id, snapshot_date),
  KEY idx_perf_snapshot_date (snapshot_date),
  CONSTRAINT fk_emp_perf_snapshot_employee FOREIGN KEY (employee_id) REFERENCES employees(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- [ ] **Step 3: Register the migration**

Open `backend/src/db/runPendingMigrations.ts`, find the array/list entry pattern used for `1252_kpi_role_template_metrics.sql` (per project memory, registered at line ~739), and add a matching entry for `1558_employee_performance_daily_snapshot.sql` immediately after the highest existing entry, following the exact same object shape.

- [ ] **Step 4: Verify migration applies**

Run: `cd backend && npm run preflight` (per this repo's deploy convention — this validates pending migrations without a full restart).
Expected: `1558_employee_performance_daily_snapshot.sql` listed as applied, no errors.

- [ ] **Step 5: Commit**

```bash
git add backend/sql/1558_employee_performance_daily_snapshot.sql backend/src/db/runPendingMigrations.ts
git commit -m "feat: add employee_performance_daily_snapshot table (migration 1558)"
```

---

### Task 2: Snapshot aggregation service

**Files:**
- Create: `backend/src/modules/performance-scorecard/performance-scorecard.types.ts`
- Create: `backend/src/modules/performance-scorecard/performance-scorecard-snapshot.service.ts`
- Test: `backend/src/modules/performance-scorecard/__tests__/performance-scorecard-snapshot.service.test.ts`

**Interfaces:**
- Consumes: `db` from `backend/src/db/index.ts` (or wherever `db.execute` is imported elsewhere in `management.service.ts` — match that import path exactly), table `employee_performance_daily_snapshot` (Task 1), tables `attendance_daily_record`, `pip_record`, `pip_checkpoint`, `kpi_daily_actual`, `employees`.
- Produces: `writeEmployeePerformanceSnapshots(date: string): Promise<{ written: number }>` — consumed by Task 3 (cron) and Task 7 (backfill script).

- [ ] **Step 1: Write types**

```ts
// backend/src/modules/performance-scorecard/performance-scorecard.types.ts
export interface EmployeePerformanceSnapshotRow {
  employeeId: string;
  snapshotDate: string; // YYYY-MM-DD
  attendanceStatus: string | null;
  lateByMinutes: number;
  unplannedLeaveFlag: boolean;
  pipStatus: "active" | "at_risk" | "off_track" | "none";
  designationId: string | null;
  qualityScore: number | null;
  templateMetrics: Record<string, number> | null;
  teamAttritionPct: number | null;
  teamShrinkagePct: number | null;
  teamRevenue: number | null;
}
```

- [ ] **Step 2: Write the failing test**

```ts
// backend/src/modules/performance-scorecard/__tests__/performance-scorecard-snapshot.service.test.ts
import { jest } from "@jest/globals";

const mockExecute = jest.fn();
jest.unstable_mockModule("../../../db/index.js", () => ({
  db: { execute: mockExecute },
}));

const { computeEmployeeSnapshot } = await import("../performance-scorecard-snapshot.service.js");

describe("computeEmployeeSnapshot", () => {
  beforeEach(() => mockExecute.mockReset());

  it("marks unplanned_leave_flag true when attendance_status is missing_punch", async () => {
    mockExecute
      .mockResolvedValueOnce([[{ attendance_status: "missing_punch", late_by_minutes: 0 }]]) // attendance
      .mockResolvedValueOnce([[]]) // active pip
      .mockResolvedValueOnce([[{ overall_score: 82.5 }]]) // quality
      .mockResolvedValueOnce([[{ designation_id: "desig-1" }]]); // employee designation

    const result = await computeEmployeeSnapshot("emp-1", "2026-08-24");

    expect(result.unplannedLeaveFlag).toBe(true);
    expect(result.pipStatus).toBe("none");
    expect(result.qualityScore).toBe(82.5);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npx jest performance-scorecard-snapshot.service.test.ts`
Expected: FAIL with "Cannot find module '../performance-scorecard-snapshot.service.js'"

- [ ] **Step 4: Write the implementation**

```ts
// backend/src/modules/performance-scorecard/performance-scorecard-snapshot.service.ts
import { randomUUID } from "node:crypto";
import { db } from "../../db/index.js";
import type { EmployeePerformanceSnapshotRow } from "./performance-scorecard.types.js";

const UNPLANNED_STATUSES = new Set(["absent", "missing_punch"]);

export async function computeEmployeeSnapshot(
  employeeId: string,
  date: string,
): Promise<EmployeePerformanceSnapshotRow> {
  const [[attendance]] = (await db.execute(
    `SELECT attendance_status, late_by_minutes FROM attendance_daily_record
      WHERE employee_id = ? AND record_date = ? LIMIT 1`,
    [employeeId, date],
  )) as any;

  const [pipRows] = (await db.execute(
    `SELECT pr.status, pc.rating
       FROM pip_record pr
       LEFT JOIN pip_checkpoint pc ON pc.pip_id = pr.id
      WHERE pr.employee_id = ? AND pr.status = 'active'
      ORDER BY pc.checkpoint_date DESC LIMIT 1`,
    [employeeId],
  )) as any;

  const [[quality]] = (await db.execute(
    `SELECT AVG(kda.actual_value) AS overall_score
       FROM kpi_daily_actual kda
      WHERE kda.employee_id = ? AND kda.score_date = ?`,
    [employeeId, date],
  )) as any;

  const [[emp]] = (await db.execute(
    `SELECT designation_id FROM employees WHERE id = ? LIMIT 1`,
    [employeeId],
  )) as any;

  const attendanceStatus: string | null = attendance?.attendance_status ?? null;
  const pipRow = pipRows?.[0];
  const pipStatus: EmployeePerformanceSnapshotRow["pipStatus"] = pipRow
    ? pipRow.rating === "off_track"
      ? "off_track"
      : pipRow.rating === "at_risk"
        ? "at_risk"
        : "active"
    : "none";

  return {
    employeeId,
    snapshotDate: date,
    attendanceStatus,
    lateByMinutes: Number(attendance?.late_by_minutes ?? 0),
    unplannedLeaveFlag: attendanceStatus !== null && UNPLANNED_STATUSES.has(attendanceStatus),
    pipStatus,
    designationId: emp?.designation_id ?? null,
    qualityScore: quality?.overall_score === null || quality?.overall_score === undefined
      ? null
      : Number(quality.overall_score),
    templateMetrics: null, // populated by role-template lookup in Task 5 follow-up (Quality baseline only for now)
    teamAttritionPct: null,
    teamShrinkagePct: null,
    teamRevenue: null,
  };
}

export async function writeEmployeePerformanceSnapshots(date: string): Promise<{ written: number }> {
  const [rows] = (await db.execute(
    `SELECT id FROM employees WHERE active_status = 1`,
  )) as any;

  let written = 0;
  for (const { id: employeeId } of rows as Array<{ id: string }>) {
    const snapshot = await computeEmployeeSnapshot(employeeId, date);
    await db.execute(
      `INSERT INTO employee_performance_daily_snapshot
         (id, employee_id, snapshot_date, attendance_status, late_by_minutes, unplanned_leave_flag,
          pip_status, designation_id, quality_score, template_metrics,
          team_attrition_pct, team_shrinkage_pct, team_revenue)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         attendance_status = VALUES(attendance_status),
         late_by_minutes = VALUES(late_by_minutes),
         unplanned_leave_flag = VALUES(unplanned_leave_flag),
         pip_status = VALUES(pip_status),
         designation_id = VALUES(designation_id),
         quality_score = VALUES(quality_score),
         template_metrics = VALUES(template_metrics),
         team_attrition_pct = VALUES(team_attrition_pct),
         team_shrinkage_pct = VALUES(team_shrinkage_pct),
         team_revenue = VALUES(team_revenue),
         updated_at = CURRENT_TIMESTAMP`,
      [
        randomUUID(),
        snapshot.employeeId,
        snapshot.snapshotDate,
        snapshot.attendanceStatus,
        snapshot.lateByMinutes,
        snapshot.unplannedLeaveFlag ? 1 : 0,
        snapshot.pipStatus,
        snapshot.designationId,
        snapshot.qualityScore,
        snapshot.templateMetrics ? JSON.stringify(snapshot.templateMetrics) : null,
        snapshot.teamAttritionPct,
        snapshot.teamShrinkagePct,
        snapshot.teamRevenue,
      ],
    );
    written += 1;
  }
  return { written };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npx jest performance-scorecard-snapshot.service.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/performance-scorecard/
git commit -m "feat: add employee performance snapshot aggregation service"
```

---

### Task 3: Nightly scheduler

**Files:**
- Create: `backend/src/modules/performance-scorecard/performance-scorecard-snapshot.cron.ts`
- Modify: `backend/src/server.ts`
- Modify: `backend/src/workers/all-workers.ts`

**Interfaces:**
- Consumes: `writeEmployeePerformanceSnapshots` from Task 2, `getIstDateString` from `backend/src/utils/dateUtils.js` (same import used by `dashboard-snapshot.cron.ts`).
- Produces: `startPerformanceScorecardSnapshotScheduler()`, `stopPerformanceScorecardSnapshotScheduler()`.

- [ ] **Step 1: Write the scheduler, mirroring `dashboard-snapshot.cron.ts`**

```ts
// backend/src/modules/performance-scorecard/performance-scorecard-snapshot.cron.ts
import { writeEmployeePerformanceSnapshots } from "./performance-scorecard-snapshot.service.js";
import { getIstDateString } from "../../utils/dateUtils.js";

let _timer: ReturnType<typeof setInterval> | null = null;
let _lastRunDate: string | null = null;
let _running = false;

const RUN_AT_HOUR_IST = 3; // 03:00 IST, after the dashboard snapshot (02:00) and attendance reconciliation.
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

function istHour(): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date()),
  );
}

async function runPerformanceScorecardSnapshot(): Promise<void> {
  if (_running) return;
  _running = true;
  try {
    const date = getIstDateString();
    const yesterday = new Date(date);
    yesterday.setDate(yesterday.getDate() - 1);
    const targetDate = yesterday.toISOString().slice(0, 10);
    const { written } = await writeEmployeePerformanceSnapshots(targetDate);
    console.log(`[performance-scorecard-cron] wrote ${written} snapshot rows for ${targetDate}`);
  } catch (err) {
    console.error("[performance-scorecard-cron] snapshot run failed", err);
  } finally {
    _running = false;
  }
}

export function startPerformanceScorecardSnapshotScheduler(): void {
  if (_timer) return;
  const tick = () => {
    const today = getIstDateString();
    if (_lastRunDate === today) return;
    if (istHour() !== RUN_AT_HOUR_IST) return;
    _lastRunDate = today;
    void runPerformanceScorecardSnapshot();
  };
  _timer = setInterval(tick, CHECK_INTERVAL_MS);
  console.log(`[performance-scorecard-cron] scheduler started (daily at ${RUN_AT_HOUR_IST}:00 IST)`);
}

export function stopPerformanceScorecardSnapshotScheduler(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}
```

- [ ] **Step 2: Register in `server.ts`**

Find the line `startDashboardSnapshotScheduler();` (around line 232) and add directly after it:
```ts
import { startPerformanceScorecardSnapshotScheduler } from "./modules/performance-scorecard/performance-scorecard-snapshot.cron.js";
// ...
startPerformanceScorecardSnapshotScheduler();
```

- [ ] **Step 3: Register in `all-workers.ts`**

Find the `dashboard-snapshot` entry (around line 238-241) and add directly after it, following the same shape:
```ts
import {
  startPerformanceScorecardSnapshotScheduler,
  stopPerformanceScorecardSnapshotScheduler,
} from "../modules/performance-scorecard/performance-scorecard-snapshot.cron.js";
// ... inside the workers array, after the dashboard-snapshot entry:
  {
    name: "performance-scorecard-snapshot",
    start: () => { startPerformanceScorecardSnapshotScheduler(); return Promise.resolve(); },
  },
// ... in the shutdown block, after stopDashboardSnapshotScheduler():
  stopPerformanceScorecardSnapshotScheduler();
```

- [ ] **Step 4: Verify it compiles and starts**

Run: `cd backend && npx tsc --noEmit performance-scorecard-snapshot.cron.ts 2>&1 || true` then `npm run dev` briefly and check the log line `[performance-scorecard-cron] scheduler started` appears, then stop it.
Expected: log line present, no startup errors.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/performance-scorecard/performance-scorecard-snapshot.cron.ts backend/src/server.ts backend/src/workers/all-workers.ts
git commit -m "feat: register nightly employee performance snapshot scheduler"
```

---

### Task 4: Backfill script

**Files:**
- Create: `backend/scripts/backfill-performance-scorecard-snapshot.ts`

**Interfaces:**
- Consumes: `writeEmployeePerformanceSnapshots` from Task 2.

- [ ] **Step 1: Write the script**

```ts
// backend/scripts/backfill-performance-scorecard-snapshot.ts
// Usage: npx tsx backend/scripts/backfill-performance-scorecard-snapshot.ts 2026-07-01 2026-08-24
import { writeEmployeePerformanceSnapshots } from "../src/modules/performance-scorecard/performance-scorecard-snapshot.service.js";

async function main() {
  const [fromArg, toArg] = process.argv.slice(2);
  if (!fromArg || !toArg) {
    console.error("Usage: backfill-performance-scorecard-snapshot.ts <fromDate YYYY-MM-DD> <toDate YYYY-MM-DD>");
    process.exit(1);
  }
  const from = new Date(fromArg);
  const to = new Date(toArg);
  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10);
    const { written } = await writeEmployeePerformanceSnapshots(dateStr);
    console.log(`${dateStr}: wrote ${written} rows`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Dry-run against a single recent day first**

Run: `cd backend && npx tsx scripts/backfill-performance-scorecard-snapshot.ts 2026-08-24 2026-08-24`
Expected: `2026-08-24: wrote <N> rows` where N is close to the active employee count.

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/backfill-performance-scorecard-snapshot.ts
git commit -m "feat: add performance scorecard snapshot backfill script"
```

(Do not run the full historical backfill yet — that happens at deploy time per Task 13.)

---

### Task 5: Dashboard metric registry entries

**Files:**
- Modify: `backend/src/shared/dashboardAccessRegistry.ts`
- Modify: `backend/src/modules/dashboards/dashboard-definition.service.ts`

**Interfaces:**
- Produces: `DashboardCode` union member `PERFORMANCE_SCORECARD`; `MetricKey` members `attendanceStatus | latecoming | unplannedLeave | pipStatus | qualityBaseline | attrition | shrinkage | revenue`; `DASHBOARD_METRICS.PERFORMANCE_SCORECARD` — consumed by Task 6 and by the frontend drawer's `dashboardCode`/`metricCode` props.

- [ ] **Step 1: Add the new `DashboardCode` member**

In `backend/src/shared/dashboardAccessRegistry.ts`, add `"PERFORMANCE_SCORECARD"` as a new member of the `DashboardCode` union (after `"EMPLOYEE_SELF_DASHBOARD"`).

- [ ] **Step 2: Add new `MetricKey` members**

In `backend/src/modules/dashboards/dashboard-definition.service.ts`, extend the `MetricKey` union (after `"leaveApprovals"`):
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

- [ ] **Step 3: Add `METRICS` entries for each new key**

Add 8 entries to the `METRICS` object, following the exact shape of the existing `leaveApprovals` entry, each pointing at a placeholder-free `execute` function imported from the new drilldown file (Task 6 will define these; for now, point `execute` at a thin wrapper — write it here since Task 6 exports it):
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
Add the corresponding import at the top of the file:
```ts
import {
  getAttendanceStatusMetric, getLatecomingMetric, getUnplannedLeaveMetric, getPipStatusMetric,
  getQualityBaselineMetric, getAttritionMetric, getShrinkageMetric, getRevenueMetric,
} from "./performance-scorecard-metric-summaries.js";
```
(These 8 summary functions are stubbed in Task 6 alongside the drilldown handlers — same file family, avoids a second near-duplicate file. If the tile-summary computation for a dashboard overview isn't needed for this feature, that's fine: they can each return a minimal `{ value: 0 }`-shaped summary consistent with the `MetricDefinition["execute"]` return type used elsewhere — check that type in this file before writing the stub bodies, and match it exactly.)

- [ ] **Step 4: Add the `DASHBOARD_METRICS` entry**

```ts
PERFORMANCE_SCORECARD: [
  "attendanceStatus", "latecoming", "unplannedLeave", "pipStatus",
  "qualityBaseline", "attrition", "shrinkage", "revenue",
],
```

- [ ] **Step 5: Verify TypeScript compiles for this module only**

Run: `cd backend && npx tsc --noEmit src/modules/dashboards/dashboard-definition.service.ts`
Expected: no new errors introduced by this file (pre-existing unrelated errors in the file are out of scope — confirm by comparing against `git stash` output if unsure).

- [ ] **Step 6: Commit**

```bash
git add backend/src/shared/dashboardAccessRegistry.ts backend/src/modules/dashboards/dashboard-definition.service.ts
git commit -m "feat: register PERFORMANCE_SCORECARD dashboard metrics"
```

---

### Task 6: Drilldown handlers

**Files:**
- Create: `backend/src/modules/dashboards/performance-scorecard-drilldown.ts`
- Modify: `backend/src/modules/dashboards/dashboard-drilldown.service.ts`
- Test: `backend/src/modules/dashboards/__tests__/performance-scorecard-drilldown.test.ts`

**Interfaces:**
- Consumes: `DrilldownResult` type and `DashboardScope`/`buildScopeWhereEmployees` from `dashboard-drilldown.service.ts` (same imports that file's existing handlers use).
- Produces: `getAttendanceStatusMetric`, `getLatecomingMetric`, `getUnplannedLeaveMetric`, `getPipStatusMetric`, `getQualityBaselineMetric`, `getAttritionMetric`, `getShrinkageMetric`, `getRevenueMetric` (tile summaries, referenced by Task 5) and `drillAttendanceStatus`, `drillLatecoming`, `drillUnplannedLeave`, `drillPipStatus`, `drillQualityBaseline`, `drillAttrition`, `drillShrinkage`, `drillRevenue` (drilldown handlers, referenced by `getDrilldown`'s switch).

- [ ] **Step 1: Write the failing test for one handler (ATTENDANCE_STATUS)**

```ts
// backend/src/modules/dashboards/__tests__/performance-scorecard-drilldown.test.ts
import { jest } from "@jest/globals";

const mockExecute = jest.fn();
jest.unstable_mockModule("../../../db/index.js", () => ({ db: { execute: mockExecute } }));
jest.unstable_mockModule("../dashboard-drilldown.service.js", () => ({
  buildScopeWhereEmployees: () => ({ sql: "1=1", params: [] }),
}));

const { drillAttendanceStatus } = await import("../performance-scorecard-drilldown.js");

describe("drillAttendanceStatus", () => {
  it("returns one record per snapshot day with attendanceStatus and lateByMinutes", async () => {
    mockExecute.mockResolvedValueOnce([[
      { employeeCode: "E100", employeeName: "Test User", snapshotDate: "2026-08-24", attendanceStatus: "present", lateByMinutes: 5 },
    ]]);

    const result = await drillAttendanceStatus({} as any, { employeeId: "emp-1", dateFrom: "2026-08-01", dateTo: "2026-08-24" });

    expect(result.metricCode).toBe("ATTENDANCE_STATUS");
    expect(result.records).toHaveLength(1);
    expect((result.records[0] as any).attendanceStatus).toBe("present");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest performance-scorecard-drilldown.test.ts`
Expected: FAIL with "Cannot find module '../performance-scorecard-drilldown.js'"

- [ ] **Step 3: Write the implementation**

```ts
// backend/src/modules/dashboards/performance-scorecard-drilldown.ts
import { db } from "../../db/index.js";
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

// Tile-summary stubs referenced by dashboard-definition.service.ts's METRICS entries (Task 5).
// Match the exact return shape of MetricDefinition["execute"] in that file before finalizing —
// these placeholders-free minimal implementations satisfy the type with a single aggregate value.
export async function getAttendanceStatusMetric() { return { value: 0 }; }
export async function getLatecomingMetric() { return { value: 0 }; }
export async function getUnplannedLeaveMetric() { return { value: 0 }; }
export async function getPipStatusMetric() { return { value: 0 }; }
export async function getQualityBaselineMetric() { return { value: 0 }; }
export async function getAttritionMetric() { return { value: 0 }; }
export async function getShrinkageMetric() { return { value: 0 }; }
export async function getRevenueMetric() { return { value: 0 }; }
```

- [ ] **Step 4: Wire the 8 cases into `getDrilldown`**

In `backend/src/modules/dashboards/dashboard-drilldown.service.ts`, add the import at the top:
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
Also export `DrilldownResult` from this file if not already exported (Task 6's Step 1 test imports it via the handler file's type-only import — confirm `export interface DrilldownResult` is present, it already is per existing code at lines 6-18).

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npx jest performance-scorecard-drilldown.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/dashboards/performance-scorecard-drilldown.ts backend/src/modules/dashboards/dashboard-drilldown.service.ts backend/src/modules/dashboards/__tests__/performance-scorecard-drilldown.test.ts
git commit -m "feat: add performance scorecard drilldown handlers"
```

---

### Task 7: RBAC-scoped scorecard route

**Files:**
- Create: `backend/src/modules/performance-scorecard/performance-scorecard.routes.ts`
- Modify: route mount file (find where `management.routes.ts` is mounted — same file, e.g. `backend/src/routes/index.ts` or `backend/src/app.ts`; use the exact mount pattern already used for `/api/management`)
- Test: `backend/src/modules/performance-scorecard/__tests__/performance-scorecard.routes.test.ts`

**Interfaces:**
- Consumes: `resolveTeamScope` (same helper `management.routes.ts` uses at its `agent-performance` route) for manager scoping; `useWorkforceAccess`-equivalent backend scope resolution for HR/Ops/CEO — reuse whatever backend scope resolver `dashboard.routes.ts`'s `requestedScope(req)` uses, since it already implements the branch/process/org-wide scope rules this route needs.
- Produces: `GET /api/performance-scorecard?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD` → `{ success: true, data: EmployeePerformanceSnapshotRow[] }` — consumed by Task 9 (frontend table).

- [ ] **Step 1: Write the failing test**

```ts
// backend/src/modules/performance-scorecard/__tests__/performance-scorecard.routes.test.ts
import { jest } from "@jest/globals";
import request from "supertest";

const mockExecute = jest.fn();
jest.unstable_mockModule("../../../db/index.js", () => ({ db: { execute: mockExecute } }));

const { createTestApp } = await import("../../../../test/helpers/createTestApp.js"); // match existing backend test harness helper
const app = await createTestApp();

describe("GET /api/performance-scorecard", () => {
  it("returns snapshot rows scoped to the caller's manager chain", async () => {
    mockExecute.mockResolvedValueOnce([[{ employee_id: "emp-1", snapshot_date: "2026-08-24", attendance_status: "present" }]]);

    const res = await request(app)
      .get("/api/performance-scorecard?dateFrom=2026-08-01&dateTo=2026-08-24")
      .set("Authorization", "Bearer demo-manager-token"); // use this repo's demo-token auth convention

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest performance-scorecard.routes.test.ts`
Expected: FAIL with "Cannot find module '../performance-scorecard.routes.js'"

- [ ] **Step 3: Write the route**

```ts
// backend/src/modules/performance-scorecard/performance-scorecard.routes.ts
import { Router, type Response } from "express";
import { db } from "../../db/index.js";
import { h } from "../../lib/asyncHandler.js"; // match the exact helper name used in management.routes.ts
import { requireRole } from "../../middleware/requireRole.js"; // match exact import used in management.routes.ts
import { resolveTeamScope } from "../management/management.service.js";
import type { AuthenticatedRequest } from "../../types/express.js";

const router = Router();

router.get(
  "/",
  requireRole("admin", "hr", "manager", "branch_head", "ceo", "process_manager", "team_leader", "assistant_manager", "wfm", "super_admin"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { dateFrom, dateTo } = req.query as { dateFrom?: string; dateTo?: string };
    if (!dateFrom || !dateTo) {
      return res.status(400).json({ success: false, message: "dateFrom and dateTo are required" });
    }
    const { employeeIds, isWide } = await resolveTeamScope(req.authUser!.id);

    const conds = ["s.snapshot_date BETWEEN ? AND ?"];
    const params: unknown[] = [dateFrom, dateTo];
    if (!isWide && employeeIds && employeeIds.length > 0) {
      conds.push(`s.employee_id IN (${employeeIds.map(() => "?").join(",")})`);
      params.push(...employeeIds);
    }

    const [rows] = (await db.execute(
      `SELECT e.id AS employeeId, e.full_name AS employeeName, e.employee_code AS employeeCode,
              s.snapshot_date AS snapshotDate, s.attendance_status AS attendanceStatus,
              s.late_by_minutes AS lateByMinutes, s.unplanned_leave_flag AS unplannedLeaveFlag,
              s.pip_status AS pipStatus, s.designation_id AS designationId,
              s.quality_score AS qualityScore, s.template_metrics AS templateMetrics,
              s.team_attrition_pct AS teamAttritionPct, s.team_shrinkage_pct AS teamShrinkagePct,
              s.team_revenue AS teamRevenue
         FROM employee_performance_daily_snapshot s
         JOIN employees e ON e.id = s.employee_id
        WHERE ${conds.join(" AND ")}
        ORDER BY e.full_name ASC, s.snapshot_date ASC
        LIMIT 5000`,
      params,
    )) as any;

    res.json({ success: true, data: rows });
  }),
);

export default router;
```

- [ ] **Step 4: Mount the router**

Open the file where `management.routes.ts` is mounted (find via `grep -r "management.routes" backend/src` if unsure of the exact mount file), and add, following the exact same pattern used for the management router:
```ts
import performanceScorecardRoutes from "./modules/performance-scorecard/performance-scorecard.routes.js";
// ... alongside app.use("/api/management", managementRoutes):
app.use("/api/performance-scorecard", performanceScorecardRoutes);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npx jest performance-scorecard.routes.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/performance-scorecard/performance-scorecard.routes.ts backend/src/modules/performance-scorecard/__tests__/performance-scorecard.routes.test.ts
git commit -m "feat: add RBAC-scoped GET /api/performance-scorecard route"
```

(The exact mount-file edit in Step 4 is committed together with whichever file it touches — include it in this commit.)

---

### Task 8: Page catalog + RBAC seed for the new Command Center page

**Files:**
- Create: `backend/sql/1559_performance_scorecard_page_catalog.sql`

**Interfaces:**
- Produces: `page_catalog` row with `page_code = 'PERFORMANCE_SCORECARD_COMMAND_CENTER'` and `role_page_access` rows for `admin, hr, wfm, ceo, super_admin, branch_head, process_manager` — consumed by `WorkforcePageGate` in Task 11.

- [ ] **Step 1: Inspect the existing `page_catalog`/`role_page_access` row shape for `PIP_MANAGEMENT`**

Run (read-only): `SELECT * FROM page_catalog WHERE page_code = 'PIP_MANAGEMENT';` and `SELECT * FROM role_page_access WHERE page_code = 'PIP_MANAGEMENT';`
Note the exact column list to match in Step 2.

- [ ] **Step 2: Write the migration**

```sql
-- backend/sql/1559_performance_scorecard_page_catalog.sql
INSERT INTO page_catalog (id, page_code, page_name, module, created_at, updated_at)
SELECT UUID(), 'PERFORMANCE_SCORECARD_COMMAND_CENTER', 'Performance Scorecard', 'performance', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM page_catalog WHERE page_code = 'PERFORMANCE_SCORECARD_COMMAND_CENTER');

INSERT INTO role_page_access (id, role_key, page_code, can_view, can_edit, created_at, updated_at)
SELECT UUID(), role_key, 'PERFORMANCE_SCORECARD_COMMAND_CENTER', 1, 0, NOW(), NOW()
FROM (SELECT 'admin' AS role_key UNION SELECT 'hr' UNION SELECT 'wfm' UNION SELECT 'ceo'
      UNION SELECT 'super_admin' UNION SELECT 'branch_head' UNION SELECT 'process_manager') roles
WHERE NOT EXISTS (
  SELECT 1 FROM role_page_access WHERE role_key = roles.role_key AND page_code = 'PERFORMANCE_SCORECARD_COMMAND_CENTER'
);
```
(Column names in Step 2 are placeholders matched against Step 1's actual findings — the engineer executing this task must replace them with the real column list observed in Step 1 before running; do not run this SQL until Step 1's output confirms the exact schema.)

- [ ] **Step 3: Register the migration**

Same pattern as Task 1 Step 3, in `backend/src/db/runPendingMigrations.ts`.

- [ ] **Step 4: Verify**

Run: `cd backend && npm run preflight`
Expected: migration `1559_performance_scorecard_page_catalog.sql` applied, `SELECT * FROM role_page_access WHERE page_code = 'PERFORMANCE_SCORECARD_COMMAND_CENTER'` returns 7 rows.

- [ ] **Step 5: Commit**

```bash
git add backend/sql/1559_performance_scorecard_page_catalog.sql backend/src/db/runPendingMigrations.ts
git commit -m "feat: seed page_catalog/role_page_access for Performance Scorecard Command Center"
```

---

### Task 9: Frontend — shared `PerformanceScorecardTable`

**Files:**
- Create: `src/components/performance-scorecard/PerformanceScorecardTable.tsx`
- Create: `src/components/performance-scorecard/performanceScorecardColumns.ts`

**Interfaces:**
- Consumes: `GET /api/performance-scorecard?dateFrom&dateTo` (Task 7), `DashboardDrilldownDrawer` (existing, props per research: `{ open, onClose, metricCode, metricName, dashboardCode, filters }`).
- Produces: `<PerformanceScorecardTable dateFrom={string} dateTo={string} />` — consumed by Task 10 (`TeamPerformanceTab`) and Task 11 (`PerformanceCommandCenter`).

- [ ] **Step 1: Write the column config**

```ts
// src/components/performance-scorecard/performanceScorecardColumns.ts
export interface ScorecardColumn {
  key: string;
  label: string;
  metricCode: string;
  format: (row: ScorecardRow) => string;
}

export interface ScorecardRow {
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  snapshotDate: string;
  attendanceStatus: string | null;
  lateByMinutes: number;
  unplannedLeaveFlag: boolean;
  pipStatus: "active" | "at_risk" | "off_track" | "none";
  qualityScore: number | null;
  teamAttritionPct: number | null;
  teamShrinkagePct: number | null;
  teamRevenue: number | null;
}

export const BASELINE_COLUMNS: ScorecardColumn[] = [
  { key: "attendanceStatus", label: "Attendance", metricCode: "ATTENDANCE_STATUS", format: (r) => r.attendanceStatus ?? "—" },
  { key: "lateByMinutes", label: "Latecoming", metricCode: "LATECOMING", format: (r) => `${r.lateByMinutes} min` },
  { key: "unplannedLeaveFlag", label: "Unplanned Leave", metricCode: "UNPLANNED_LEAVE", format: (r) => (r.unplannedLeaveFlag ? "Yes" : "No") },
  { key: "pipStatus", label: "PIP", metricCode: "PIP_STATUS", format: (r) => r.pipStatus },
];

export const TEMPLATE_COLUMNS: ScorecardColumn[] = [
  { key: "qualityScore", label: "Quality", metricCode: "QUALITY_BASELINE", format: (r) => (r.qualityScore === null ? "—" : r.qualityScore.toFixed(1)) },
  { key: "teamAttritionPct", label: "Attrition", metricCode: "ATTRITION", format: (r) => (r.teamAttritionPct === null ? "—" : `${r.teamAttritionPct.toFixed(1)}%`) },
  { key: "teamShrinkagePct", label: "Shrinkage", metricCode: "SHRINKAGE", format: (r) => (r.teamShrinkagePct === null ? "—" : `${r.teamShrinkagePct.toFixed(1)}%`) },
  { key: "teamRevenue", label: "Revenue", metricCode: "REVENUE", format: (r) => (r.teamRevenue === null ? "—" : `₹${r.teamRevenue.toLocaleString("en-IN")}`) },
];
```

- [ ] **Step 2: Write the table component**

```tsx
// src/components/performance-scorecard/PerformanceScorecardTable.tsx
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import DashboardDrilldownDrawer from "@/components/dashboard/DashboardDrilldownDrawer";
import { BASELINE_COLUMNS, TEMPLATE_COLUMNS, type ScorecardRow } from "./performanceScorecardColumns";

interface PerformanceScorecardTableProps {
  dateFrom: string;
  dateTo: string;
}

function groupByEmployee(rows: ScorecardRow[]): ScorecardRow[] {
  // one row per employee per date range: take the most recent snapshot within range as the display row
  const byEmployee = new Map<string, ScorecardRow>();
  for (const row of rows) {
    const existing = byEmployee.get(row.employeeId);
    if (!existing || row.snapshotDate > existing.snapshotDate) byEmployee.set(row.employeeId, row);
  }
  return Array.from(byEmployee.values());
}

export default function PerformanceScorecardTable({ dateFrom, dateTo }: PerformanceScorecardTableProps) {
  const [drilldown, setDrilldown] = useState<{ employeeId: string; metricCode: string; metricName: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["performance-scorecard", dateFrom, dateTo],
    queryFn: () =>
      hrmsApi.get<{ success: boolean; data: ScorecardRow[] }>(
        `/api/performance-scorecard?dateFrom=${dateFrom}&dateTo=${dateTo}`,
      ),
    staleTime: 5 * 60_000,
  });

  const rows = useMemo(() => groupByEmployee(data?.data ?? []), [data]);
  const columns = [...BASELINE_COLUMNS, ...TEMPLATE_COLUMNS];

  if (isLoading) return <div className="p-6 text-sm text-gray-500">Loading scorecard…</div>;

  return (
    <div className="overflow-x-auto rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="sticky left-0 bg-white/95 z-10">Employee</TableHead>
            {columns.map((col) => (
              <TableHead key={col.key}>{col.label}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.employeeId}>
              <TableCell className="sticky left-0 bg-white z-10">
                <div className="flex items-center gap-2">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback>{row.employeeName.slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <span className="font-semibold text-gray-800">{row.employeeName}</span>
                </div>
              </TableCell>
              {columns.map((col) => (
                <TableCell
                  key={col.key}
                  className="cursor-pointer hover:underline"
                  onClick={() => setDrilldown({ employeeId: row.employeeId, metricCode: col.metricCode, metricName: col.label })}
                >
                  {col.key === "pipStatus" ? (
                    <Badge variant={row.pipStatus === "off_track" ? "destructive" : row.pipStatus === "at_risk" ? "secondary" : "outline"}>
                      {col.format(row)}
                    </Badge>
                  ) : (
                    col.format(row)
                  )}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {drilldown && (
        <DashboardDrilldownDrawer
          open={true}
          onClose={() => setDrilldown(null)}
          metricCode={drilldown.metricCode}
          metricName={drilldown.metricName}
          dashboardCode="PERFORMANCE_SCORECARD"
          filters={{ employeeId: drilldown.employeeId, dateFrom, dateTo }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify it builds**

Run: `npm run build -- --mode development 2>&1 | tail -50` (or `npx tsc --noEmit` scoped to this file if the project has a faster per-file check)
Expected: no new TypeScript errors from this file.

- [ ] **Step 4: Commit**

```bash
git add src/components/performance-scorecard/
git commit -m "feat: add shared PerformanceScorecardTable component"
```

---

### Task 10: Wire into `TeamPerformanceTab`

**Files:**
- Modify: `src/components/my-team/TeamPerformanceTab.tsx`

**Interfaces:**
- Consumes: `PerformanceScorecardTable` from Task 9.

- [ ] **Step 1: Add a date-range state and replace the table section**

In `TeamPerformanceTab.tsx`, add near the top of the component body (after existing `useState` calls):
```tsx
const [dateFrom, setDateFrom] = useState(() => {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
});
const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
```
Add a date-range control above the existing bar chart (keep the existing chart and coaching dialog untouched — they still read `perfData`):
```tsx
<div className="flex items-center gap-2 mb-4">
  <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
  <span className="text-gray-400">to</span>
  <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
</div>
```
Replace the existing `<Table>...</Table>` block (lines ~170-220, the flat quality/risk/coaching table) with:
```tsx
<PerformanceScorecardTable dateFrom={dateFrom} dateTo={dateTo} />
```
Add the import at the top:
```tsx
import PerformanceScorecardTable from "@/components/performance-scorecard/PerformanceScorecardTable";
```
Leave the existing `agent-performance` query, bar chart, and coaching `Dialog` in place unchanged — they are independent of the table being replaced.

- [ ] **Step 2: Manual verification**

Run the app (`npm run dev`), log in as a manager-role demo account, navigate to My Team → Performance, confirm the new table renders with a date-range picker and the bar chart above it still works.
Expected: table shows employee rows with Attendance/Latecoming/Unplanned Leave/PIP + template columns; clicking a cell opens the drilldown drawer.

- [ ] **Step 3: Commit**

```bash
git add src/components/my-team/TeamPerformanceTab.tsx
git commit -m "feat: wire PerformanceScorecardTable into TeamPerformanceTab"
```

---

### Task 11: New Performance Command Center page (HR/Ops/CEO)

**Files:**
- Create: `src/pages/PerformanceCommandCenter.tsx`
- Modify: `src/config/routes/performance.routes.tsx`
- Modify: `src/components/layout/navConfig.tsx`

**Interfaces:**
- Consumes: `PerformanceScorecardTable` (Task 9), `WorkforcePageGate` (`{ pageCode, children }`), `useWorkforceAccess` (`{ scopeDescription }` via `useWfmScopeFilter`).

- [ ] **Step 1: Write the page**

```tsx
// src/pages/PerformanceCommandCenter.tsx
import { useState } from "react";
import PerformanceScorecardTable from "@/components/performance-scorecard/PerformanceScorecardTable";
import { useWfmScopeFilter } from "@/hooks/useWfmScopeFilter";
import { Input } from "@/components/ui/input";

export default function PerformanceCommandCenter() {
  const { scopeDescription } = useWfmScopeFilter();
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));

  return (
    <div className="p-4 sm:p-6">
      <div className="rounded-3xl bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-500 text-white p-6 mb-6">
        <h1 className="text-2xl font-bold">Performance Scorecard</h1>
        <p className="text-white/80 text-sm mt-1">{scopeDescription}</p>
      </div>
      <div className="flex items-center gap-2 mb-4">
        <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
        <span className="text-gray-400">to</span>
        <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
      </div>
      <PerformanceScorecardTable dateFrom={dateFrom} dateTo={dateTo} />
    </div>
  );
}
```

- [ ] **Step 2: Add the route**

In `src/config/routes/performance.routes.tsx`, add the lazy import near the other lazy imports:
```tsx
const PerformanceCommandCenter = lazy(() => import("@/pages/PerformanceCommandCenter"));
```
And add the route inside `performanceRouteElements`, following the exact `PIP_MANAGEMENT` entry's shape:
```tsx
<Route path="/performance-command-center" element={<ProtectedRoute><Gate pageCode="PERFORMANCE_SCORECARD_COMMAND_CENTER"><PerformanceCommandCenter /></Gate></ProtectedRoute>} />
```

- [ ] **Step 3: Add the nav entry**

In `src/components/layout/navConfig.tsx`, inside the Performance section's `children` array, add (matching the `PIP Management` entry's shape, importing `Gauge` or another unused lucide icon at the top):
```tsx
{ label: "Performance Scorecard", href: "/performance-command-center", icon: ic(Gauge), pageCode: "PERFORMANCE_SCORECARD_COMMAND_CENTER", description: "Full-org performance scorecard across all employees" },
```

- [ ] **Step 4: Manual verification**

Log in as an HR/Ops demo account with the `PERFORMANCE_SCORECARD_COMMAND_CENTER` page grant (from Task 8), navigate to `/performance-command-center` via the nav, confirm the page loads and shows rows across the account's full scope (not just direct reports).
Expected: page renders, `scopeDescription` shows the correct branch/process/org-wide text, table shows employees beyond the logged-in user's direct team.

- [ ] **Step 5: Commit**

```bash
git add src/pages/PerformanceCommandCenter.tsx src/config/routes/performance.routes.tsx src/components/layout/navConfig.tsx
git commit -m "feat: add Performance Command Center page for HR/Ops/CEO"
```

---

### Task 12: Compare panel

**Files:**
- Create: `src/components/performance-scorecard/PerformanceCompareModal.tsx`
- Modify: `src/components/performance-scorecard/PerformanceScorecardTable.tsx`

**Interfaces:**
- Consumes: `GET /api/performance-scorecard?dateFrom&dateTo` (same endpoint as Task 9, filtered client-side to the selected employee's full date range — the endpoint already returns per-day rows, not just the latest).

- [ ] **Step 1: Write the compare modal**

```tsx
// src/components/performance-scorecard/PerformanceCompareModal.tsx
import { useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import type { ScorecardRow } from "./performanceScorecardColumns";

const COMPARABLE_METRICS: Array<{ key: keyof ScorecardRow; label: string; color: string }> = [
  { key: "lateByMinutes", label: "Latecoming (min)", color: "#dc2626" },
  { key: "qualityScore", label: "Quality", color: "#15803d" },
  { key: "teamAttritionPct", label: "Attrition (%)", color: "#ea580c" },
  { key: "teamShrinkagePct", label: "Shrinkage (%)", color: "#6d28d9" },
];

interface PerformanceCompareModalProps {
  open: boolean;
  onClose: () => void;
  employeeName: string;
  rows: ScorecardRow[]; // all snapshot-date rows for one employee across the selected range
}

export default function PerformanceCompareModal({ open, onClose, employeeName, rows }: PerformanceCompareModalProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set(["lateByMinutes", "qualityScore"]));

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else if (next.size < 4) next.add(key);
      return next;
    });
  };

  const chartData = rows.map((r) => ({
    date: r.snapshotDate,
    lateByMinutes: r.lateByMinutes,
    qualityScore: r.qualityScore,
    teamAttritionPct: r.teamAttritionPct,
    teamShrinkagePct: r.teamShrinkagePct,
  }));

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Compare metrics — {employeeName}</DialogTitle>
        </DialogHeader>
        <div className="flex gap-4 flex-wrap mb-4">
          {COMPARABLE_METRICS.map((m) => (
            <label key={m.key} className="flex items-center gap-2 text-sm">
              <Checkbox checked={selected.has(m.key as string)} onCheckedChange={() => toggle(m.key as string)} />
              {m.label}
            </label>
          ))}
        </div>
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Legend />
            {COMPARABLE_METRICS.filter((m) => selected.has(m.key as string)).map((m) => (
              <Line key={m.key} type="monotone" dataKey={m.key as string} stroke={m.color} name={m.label} connectNulls />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Wire a "Compare" trigger into `PerformanceScorecardTable`**

In `PerformanceScorecardTable.tsx`, add state and a per-row trigger:
```tsx
const [compareEmployee, setCompareEmployee] = useState<{ id: string; name: string } | null>(null);
```
Add a "Compare" button cell at the end of each row (inside the existing `<TableRow>`, after the metric cells):
```tsx
<TableCell>
  <button className="text-xs text-indigo-600 hover:underline" onClick={() => setCompareEmployee({ id: row.employeeId, name: row.employeeName })}>
    Compare
  </button>
</TableCell>
```
Add the matching header cell `<TableHead>Compare</TableHead>` after the metric column headers.
Render the modal at the bottom of the component, filtering `data?.data` (the full unfiltered per-day rows, not the `groupByEmployee`-reduced `rows`) to the selected employee:
```tsx
{compareEmployee && (
  <PerformanceCompareModal
    open={true}
    onClose={() => setCompareEmployee(null)}
    employeeName={compareEmployee.name}
    rows={(data?.data ?? []).filter((r) => r.employeeId === compareEmployee.id)}
  />
)}
```
Add the import: `import PerformanceCompareModal from "./PerformanceCompareModal";`

- [ ] **Step 3: Manual verification**

Run the app, open the scorecard table, click "Compare" on a row, toggle metrics, confirm the line chart updates and stays capped at 4 selected metrics.
Expected: chart renders with selected lines only, checkbox beyond 4th selection is a no-op.

- [ ] **Step 4: Commit**

```bash
git add src/components/performance-scorecard/PerformanceCompareModal.tsx src/components/performance-scorecard/PerformanceScorecardTable.tsx
git commit -m "feat: add multi-metric compare panel to performance scorecard"
```

---

### Task 13: RBAC regression test + historical backfill run

**Files:**
- Test: `backend/src/modules/performance-scorecard/__tests__/performance-scorecard.rbac.test.ts`

**Interfaces:**
- Consumes: `resolveTeamScope` (same as Task 7).

- [ ] **Step 1: Write the RBAC test**

```ts
// backend/src/modules/performance-scorecard/__tests__/performance-scorecard.rbac.test.ts
import { jest } from "@jest/globals";
import request from "supertest";

const mockExecute = jest.fn();
jest.unstable_mockModule("../../../db/index.js", () => ({ db: { execute: mockExecute } }));

const { createTestApp } = await import("../../../../test/helpers/createTestApp.js");
const app = await createTestApp();

describe("GET /api/performance-scorecard RBAC", () => {
  it("scopes results to employee_id IN (...) for a non-wide manager", async () => {
    mockExecute.mockResolvedValueOnce([[]]);

    await request(app)
      .get("/api/performance-scorecard?dateFrom=2026-08-01&dateTo=2026-08-24")
      .set("Authorization", "Bearer demo-manager-token");

    const [sql, params] = mockExecute.mock.calls[mockExecute.mock.calls.length - 1] as [string, unknown[]];
    expect(sql).toContain("s.employee_id IN");
    expect(params.length).toBeGreaterThan(2); // dateFrom, dateTo, plus at least one scoped employee id
  });

  it("does not scope results for an org-wide role", async () => {
    mockExecute.mockResolvedValueOnce([[]]);

    await request(app)
      .get("/api/performance-scorecard?dateFrom=2026-08-01&dateTo=2026-08-24")
      .set("Authorization", "Bearer demo-ceo-token");

    const [sql] = mockExecute.mock.calls[mockExecute.mock.calls.length - 1] as [string, unknown[]];
    expect(sql).not.toContain("s.employee_id IN");
  });
});
```

- [ ] **Step 2: Run and confirm both pass**

Run: `cd backend && npx jest performance-scorecard.rbac.test.ts`
Expected: PASS on both cases. If the "does not scope" case fails, `resolveTeamScope`'s `isWide` flag is not being honored correctly in Task 7's route — fix the route, not the test.

- [ ] **Step 3: Run the full historical backfill**

Determine the earliest date needed (30-60 days back is enough for initial trend charts to be meaningful — confirm with whoever is deploying this). Run:
```bash
cd backend && npx tsx scripts/backfill-performance-scorecard-snapshot.ts 2026-06-25 2026-08-24
```
Expected: one `wrote <N> rows` line per day, no errors. Spot-check: `SELECT COUNT(*) FROM employee_performance_daily_snapshot;` should be roughly `active_employee_count * days_backfilled`.

- [ ] **Step 4: Run the full backend test suite**

Run: `cd backend && npm test 2>&1 | tail -60`
Expected: full suite green, per this repo's zero-baseline CI convention — no new failures introduced.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/performance-scorecard/__tests__/performance-scorecard.rbac.test.ts
git commit -m "test: add RBAC scoping regression test for performance scorecard"
```

---

## Notes for the executing agent

- Tasks 5 and 6 touch the same two files (`dashboard-definition.service.ts`, `dashboard-drilldown.service.ts`) that many other features also touch — re-read the current file content immediately before editing each time, per this repo's known "shared tree clobbers edits" risk under concurrent sessions.
- The tile-summary stub functions in Task 6 Step 3 return `{ value: 0 }` — if `dashboard-definition.service.ts`'s `MetricDefinition["execute"]` return type is stricter than that, the implementing agent must match it exactly (read the type before writing the stubs, do not guess).
- Task 8's SQL uses illustrative column names for `page_catalog`/`role_page_access` — Step 1 of that task requires pulling the real schema first; do not run Step 2's SQL unmodified without doing so.
- Do not touch `backend/src/modules/management/management.service.ts`'s `getTeamKpiSummary` or its route — it remains in place, unmodified, for any other existing consumer.
