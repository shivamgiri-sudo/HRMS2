# Task 2 Brief: Snapshot aggregation service

Source plan: `docs/superpowers/plans/2026-08-25-employee-performance-scorecard.md` (Task 2)

## Global Constraints (binding on this task)

- Unplanned leave, for this feature, is defined as `attendance_daily_record.attendance_status IN ('absent', 'missing_punch')` for a given day — this mirrors the existing project ruling that an unresolved `missing_punch` is unpaid/unplanned. Do not invent a different definition.
- Never modify payroll/salary calculation logic (not touched by this task).

## Prior task output you depend on

Task 1 created the table `employee_performance_daily_snapshot` (migration `backend/sql/migrations/1604_employee_performance_daily_snapshot.sql`, already applied/registered). Columns: `id`, `employee_id`, `snapshot_date`, `attendance_status`, `late_by_minutes`, `unplanned_leave_flag`, `pip_status`, `designation_id`, `quality_score`, `template_metrics`, `team_attrition_pct`, `team_shrinkage_pct`, `team_revenue`, `created_at`, `updated_at`. Confirm this table exists before writing queries against it (`DESCRIBE employee_performance_daily_snapshot`).

## Task

**Files:**
- Create: `backend/src/modules/performance-scorecard/performance-scorecard.types.ts`
- Create: `backend/src/modules/performance-scorecard/performance-scorecard-snapshot.service.ts`
- Test: `backend/src/modules/performance-scorecard/__tests__/performance-scorecard-snapshot.service.test.ts`

**Interfaces:**
- Consumes: the `db` export used elsewhere in this codebase for MySQL queries (find the exact import path by checking how `backend/src/modules/management/management.service.ts` imports its DB client — match that path exactly, do not guess `../../db/index.js` without confirming).
- Produces: `writeEmployeePerformanceSnapshots(date: string): Promise<{ written: number }>` and `computeEmployeeSnapshot(employeeId: string, date: string): Promise<EmployeePerformanceSnapshotRow>` — both will be consumed by later tasks (a nightly cron and a backfill script), so keep these exact names and signatures.

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
NOTE: adjust the `jest.unstable_mockModule` path to match whatever real import path you determine in Step 3 (this example assumes `../../../db/index.js` — confirm and correct if different).

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npx jest performance-scorecard-snapshot.service.test.ts`
Expected: FAIL with "Cannot find module '../performance-scorecard-snapshot.service.js'"

- [ ] **Step 4: Write the implementation**

```ts
// backend/src/modules/performance-scorecard/performance-scorecard-snapshot.service.ts
import { randomUUID } from "node:crypto";
import { db } from "../../db/index.js"; // CONFIRM this import path matches management.service.ts's actual import
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
    templateMetrics: null,
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
Stage ONLY the `backend/src/modules/performance-scorecard/` directory (your new files). Do not use `git add -A`, `git add .`, or `git commit -a` — this repo has multiple concurrent sessions editing the shared working tree, and a broad add will sweep in someone else's in-progress files. Run `git status --short` first and confirm only your files are listed before committing.

## Report contract

Write your full report to `.superpowers/sdd/employee-performance-scorecard/reports/task-2-report.md`, then return ONLY:
- Status: DONE / DONE_WITH_CONCERNS / NEEDS_CONTEXT / BLOCKED
- Commit SHA(s)
- One-line test/verification summary
- Any concerns

## Important

- Do NOT push to GitHub. Commit locally to `main` only (this repo's established convention — no feature branches) — pushing requires separate explicit approval that has not been given for this task.
- This repo has concurrent sessions editing the same shared working tree at the same time. `git fetch` and re-check `git log` immediately before you commit. Stage only your own explicit file paths — never a broad add.
- Do not touch any file outside this task's file list.
- If you have questions before starting, ask them instead of guessing.
