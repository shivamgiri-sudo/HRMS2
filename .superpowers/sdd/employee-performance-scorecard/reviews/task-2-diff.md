COMMITS IN RANGE (only 26fbc5fb is this task's; others are concurrent unrelated commits):
26fbc5fb feat: add employee performance snapshot aggregation service
e94bfe3f chore(route-contract): revert spurious KNOWN_GAPS entry for GET /api/branches
1cecbe3c chore(route-contract): add KNOWN_GAPS entry for legacy GET /api/branches

STAT (this task's commit only):
commit 26fbc5fb144b1d597fd4d071038ded5aeee7b54e
Author: Shivam Giri <shivamgiri@users.noreply.github.com>
Date:   Tue Aug 25 03:38:15 2026 +0530

    feat: add employee performance snapshot aggregation service
    
    Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

 .../performance-scorecard-snapshot.service.test.ts |  24 +++++
 .../performance-scorecard-snapshot.service.ts      | 112 +++++++++++++++++++++
 .../performance-scorecard.types.ts                 |  14 +++
 3 files changed, 150 insertions(+)

FULL DIFF (this task's commit only):
commit 26fbc5fb144b1d597fd4d071038ded5aeee7b54e
Author: Shivam Giri <shivamgiri@users.noreply.github.com>
Date:   Tue Aug 25 03:38:15 2026 +0530

    feat: add employee performance snapshot aggregation service
    
    Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

diff --git a/backend/src/modules/performance-scorecard/__tests__/performance-scorecard-snapshot.service.test.ts b/backend/src/modules/performance-scorecard/__tests__/performance-scorecard-snapshot.service.test.ts
new file mode 100644
index 00000000..ce105e8d
--- /dev/null
+++ b/backend/src/modules/performance-scorecard/__tests__/performance-scorecard-snapshot.service.test.ts
@@ -0,0 +1,24 @@
+import { beforeEach, describe, expect, it, vi } from "vitest";
+
+const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
+vi.mock("../../../db/mysql.js", () => ({ db: { execute: mocks.execute } }));
+
+import { computeEmployeeSnapshot } from "../performance-scorecard-snapshot.service.js";
+
+describe("computeEmployeeSnapshot", () => {
+  beforeEach(() => mocks.execute.mockReset());
+
+  it("marks unplanned_leave_flag true when attendance_status is missing_punch", async () => {
+    mocks.execute
+      .mockResolvedValueOnce([[{ attendance_status: "missing_punch", late_by_minutes: 0 }]]) // attendance
+      .mockResolvedValueOnce([[]]) // active pip
+      .mockResolvedValueOnce([[{ overall_score: 82.5 }]]) // quality
+      .mockResolvedValueOnce([[{ designation_id: "desig-1" }]]); // employee designation
+
+    const result = await computeEmployeeSnapshot("emp-1", "2026-08-24");
+
+    expect(result.unplannedLeaveFlag).toBe(true);
+    expect(result.pipStatus).toBe("none");
+    expect(result.qualityScore).toBe(82.5);
+  });
+});
diff --git a/backend/src/modules/performance-scorecard/performance-scorecard-snapshot.service.ts b/backend/src/modules/performance-scorecard/performance-scorecard-snapshot.service.ts
new file mode 100644
index 00000000..9d2fec7e
--- /dev/null
+++ b/backend/src/modules/performance-scorecard/performance-scorecard-snapshot.service.ts
@@ -0,0 +1,112 @@
+import { randomUUID } from "node:crypto";
+import { db } from "../../db/mysql.js";
+import type { EmployeePerformanceSnapshotRow } from "./performance-scorecard.types.js";
+
+const UNPLANNED_STATUSES = new Set(["absent", "missing_punch"]);
+
+export async function computeEmployeeSnapshot(
+  employeeId: string,
+  date: string,
+): Promise<EmployeePerformanceSnapshotRow> {
+  const [[attendance]] = (await db.execute(
+    `SELECT attendance_status, late_by_minutes FROM attendance_daily_record
+      WHERE employee_id = ? AND record_date = ? LIMIT 1`,
+    [employeeId, date],
+  )) as any;
+
+  const [pipRows] = (await db.execute(
+    `SELECT pr.status, pc.rating
+       FROM pip_record pr
+       LEFT JOIN pip_checkpoint pc ON pc.pip_id = pr.id
+      WHERE pr.employee_id = ? AND pr.status = 'active'
+      ORDER BY pc.checkpoint_date DESC LIMIT 1`,
+    [employeeId],
+  )) as any;
+
+  const [[quality]] = (await db.execute(
+    `SELECT AVG(kda.actual_value) AS overall_score
+       FROM kpi_daily_actual kda
+      WHERE kda.employee_id = ? AND kda.score_date = ?`,
+    [employeeId, date],
+  )) as any;
+
+  const [[emp]] = (await db.execute(
+    `SELECT designation_id FROM employees WHERE id = ? LIMIT 1`,
+    [employeeId],
+  )) as any;
+
+  const attendanceStatus: string | null = attendance?.attendance_status ?? null;
+  const pipRow = pipRows?.[0];
+  const pipStatus: EmployeePerformanceSnapshotRow["pipStatus"] = pipRow
+    ? pipRow.rating === "off_track"
+      ? "off_track"
+      : pipRow.rating === "at_risk"
+        ? "at_risk"
+        : "active"
+    : "none";
+
+  return {
+    employeeId,
+    snapshotDate: date,
+    attendanceStatus,
+    lateByMinutes: Number(attendance?.late_by_minutes ?? 0),
+    unplannedLeaveFlag: attendanceStatus !== null && UNPLANNED_STATUSES.has(attendanceStatus),
+    pipStatus,
+    designationId: emp?.designation_id ?? null,
+    qualityScore:
+      quality?.overall_score === null || quality?.overall_score === undefined
+        ? null
+        : Number(quality.overall_score),
+    templateMetrics: null,
+    teamAttritionPct: null,
+    teamShrinkagePct: null,
+    teamRevenue: null,
+  };
+}
+
+export async function writeEmployeePerformanceSnapshots(date: string): Promise<{ written: number }> {
+  const [rows] = (await db.execute(
+    `SELECT id FROM employees WHERE active_status = 1`,
+  )) as any;
+
+  let written = 0;
+  for (const { id: employeeId } of rows as Array<{ id: string }>) {
+    const snapshot = await computeEmployeeSnapshot(employeeId, date);
+    await db.execute(
+      `INSERT INTO employee_performance_daily_snapshot
+         (id, employee_id, snapshot_date, attendance_status, late_by_minutes, unplanned_leave_flag,
+          pip_status, designation_id, quality_score, template_metrics,
+          team_attrition_pct, team_shrinkage_pct, team_revenue)
+       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
+       ON DUPLICATE KEY UPDATE
+         attendance_status = VALUES(attendance_status),
+         late_by_minutes = VALUES(late_by_minutes),
+         unplanned_leave_flag = VALUES(unplanned_leave_flag),
+         pip_status = VALUES(pip_status),
+         designation_id = VALUES(designation_id),
+         quality_score = VALUES(quality_score),
+         template_metrics = VALUES(template_metrics),
+         team_attrition_pct = VALUES(team_attrition_pct),
+         team_shrinkage_pct = VALUES(team_shrinkage_pct),
+         team_revenue = VALUES(team_revenue),
+         updated_at = CURRENT_TIMESTAMP`,
+      [
+        randomUUID(),
+        snapshot.employeeId,
+        snapshot.snapshotDate,
+        snapshot.attendanceStatus,
+        snapshot.lateByMinutes,
+        snapshot.unplannedLeaveFlag ? 1 : 0,
+        snapshot.pipStatus,
+        snapshot.designationId,
+        snapshot.qualityScore,
+        snapshot.templateMetrics ? JSON.stringify(snapshot.templateMetrics) : null,
+        snapshot.teamAttritionPct,
+        snapshot.teamShrinkagePct,
+        snapshot.teamRevenue,
+      ],
+    );
+    written += 1;
+  }
+  return { written };
+}
diff --git a/backend/src/modules/performance-scorecard/performance-scorecard.types.ts b/backend/src/modules/performance-scorecard/performance-scorecard.types.ts
new file mode 100644
index 00000000..df0dae8c
--- /dev/null
+++ b/backend/src/modules/performance-scorecard/performance-scorecard.types.ts
@@ -0,0 +1,14 @@
+export interface EmployeePerformanceSnapshotRow {
+  employeeId: string;
+  snapshotDate: string; // YYYY-MM-DD
+  attendanceStatus: string | null;
+  lateByMinutes: number;
+  unplannedLeaveFlag: boolean;
+  pipStatus: "active" | "at_risk" | "off_track" | "none";
+  designationId: string | null;
+  qualityScore: number | null;
+  templateMetrics: Record<string, number> | null;
+  teamAttritionPct: number | null;
+  teamShrinkagePct: number | null;
+  teamRevenue: number | null;
+}
