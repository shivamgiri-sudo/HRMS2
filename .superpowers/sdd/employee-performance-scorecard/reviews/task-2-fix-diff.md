commit 077974636caf39f32bf74d5f1560d07f32db80fd
Author: Shivam Giri <shivamgiri@users.noreply.github.com>
Date:   Tue Aug 25 03:43:28 2026 +0530

    fix: isolate per-employee failures in performance snapshot batch write
    
    Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

diff --git a/backend/src/modules/performance-scorecard/__tests__/performance-scorecard-snapshot.service.test.ts b/backend/src/modules/performance-scorecard/__tests__/performance-scorecard-snapshot.service.test.ts
index ce105e8d..e52d4785 100644
--- a/backend/src/modules/performance-scorecard/__tests__/performance-scorecard-snapshot.service.test.ts
+++ b/backend/src/modules/performance-scorecard/__tests__/performance-scorecard-snapshot.service.test.ts
@@ -1,24 +1,53 @@
 import { beforeEach, describe, expect, it, vi } from "vitest";
 
 const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
 vi.mock("../../../db/mysql.js", () => ({ db: { execute: mocks.execute } }));
 
-import { computeEmployeeSnapshot } from "../performance-scorecard-snapshot.service.js";
+import {
+  computeEmployeeSnapshot,
+  writeEmployeePerformanceSnapshots,
+} from "../performance-scorecard-snapshot.service.js";
 
 describe("computeEmployeeSnapshot", () => {
   beforeEach(() => mocks.execute.mockReset());
 
   it("marks unplanned_leave_flag true when attendance_status is missing_punch", async () => {
     mocks.execute
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
+
+describe("writeEmployeePerformanceSnapshots", () => {
+  beforeEach(() => mocks.execute.mockReset());
+
+  it("continues past a failing employee and still writes the next one, reporting the error", async () => {
+    mocks.execute
+      // SELECT active employees
+      .mockResolvedValueOnce([[{ id: "emp-fail" }, { id: "emp-ok" }]])
+      // emp-fail: computeEmployeeSnapshot's first query throws
+      .mockRejectedValueOnce(new Error("connection reset"))
+      // emp-ok: computeEmployeeSnapshot's 4 queries succeed
+      .mockResolvedValueOnce([[{ attendance_status: "present", late_by_minutes: 0 }]]) // attendance
+      .mockResolvedValueOnce([[]]) // active pip
+      .mockResolvedValueOnce([[{ overall_score: 90 }]]) // quality
+      .mockResolvedValueOnce([[{ designation_id: "desig-2" }]]) // employee designation
+      // emp-ok: INSERT
+      .mockResolvedValueOnce([{}]);
+
+    const result = await writeEmployeePerformanceSnapshots("2026-08-24");
+
+    expect(result.written).toBe(1);
+    expect(result.errors).toHaveLength(1);
+    expect(result.errors[0].employeeId).toBe("emp-fail");
+    expect(result.errors[0].error).toContain("connection reset");
+  });
+});
diff --git a/backend/src/modules/performance-scorecard/performance-scorecard-snapshot.service.ts b/backend/src/modules/performance-scorecard/performance-scorecard-snapshot.service.ts
index 9d2fec7e..f6424a08 100644
--- a/backend/src/modules/performance-scorecard/performance-scorecard-snapshot.service.ts
+++ b/backend/src/modules/performance-scorecard/performance-scorecard-snapshot.service.ts
@@ -57,56 +57,77 @@ export async function computeEmployeeSnapshot(
       quality?.overall_score === null || quality?.overall_score === undefined
         ? null
         : Number(quality.overall_score),
     templateMetrics: null,
     teamAttritionPct: null,
     teamShrinkagePct: null,
     teamRevenue: null,
   };
 }
 
-export async function writeEmployeePerformanceSnapshots(date: string): Promise<{ written: number }> {
+/**
+ * Writes daily performance snapshots for all active employees.
+ *
+ * Each employee is processed independently: a failure computing or writing
+ * one employee's snapshot (bad data, FK issue, transient connection error)
+ * is caught, logged and recorded in `errors`, and processing continues with
+ * the remaining employees rather than aborting the whole batch.
+ */
+export async function writeEmployeePerformanceSnapshots(
+  date: string,
+): Promise<{ written: number; errors: Array<{ employeeId: string; error: string }> }> {
   const [rows] = (await db.execute(
     `SELECT id FROM employees WHERE active_status = 1`,
   )) as any;
 
   let written = 0;
+  const errors: Array<{ employeeId: string; error: string }> = [];
+
   for (const { id: employeeId } of rows as Array<{ id: string }>) {
-    const snapshot = await computeEmployeeSnapshot(employeeId, date);
-    await db.execute(
-      `INSERT INTO employee_performance_daily_snapshot
-         (id, employee_id, snapshot_date, attendance_status, late_by_minutes, unplanned_leave_flag,
-          pip_status, designation_id, quality_score, template_metrics,
-          team_attrition_pct, team_shrinkage_pct, team_revenue)
-       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
-       ON DUPLICATE KEY UPDATE
-         attendance_status = VALUES(attendance_status),
-         late_by_minutes = VALUES(late_by_minutes),
-         unplanned_leave_flag = VALUES(unplanned_leave_flag),
-         pip_status = VALUES(pip_status),
-         designation_id = VALUES(designation_id),
-         quality_score = VALUES(quality_score),
-         template_metrics = VALUES(template_metrics),
-         team_attrition_pct = VALUES(team_attrition_pct),
-         team_shrinkage_pct = VALUES(team_shrinkage_pct),
-         team_revenue = VALUES(team_revenue),
-         updated_at = CURRENT_TIMESTAMP`,
-      [
-        randomUUID(),
-        snapshot.employeeId,
-        snapshot.snapshotDate,
-        snapshot.attendanceStatus,
-        snapshot.lateByMinutes,
-        snapshot.unplannedLeaveFlag ? 1 : 0,
-        snapshot.pipStatus,
-        snapshot.designationId,
-        snapshot.qualityScore,
-        snapshot.templateMetrics ? JSON.stringify(snapshot.templateMetrics) : null,
-        snapshot.teamAttritionPct,
-        snapshot.teamShrinkagePct,
-        snapshot.teamRevenue,
-      ],
-    );
-    written += 1;
+    try {
+      const snapshot = await computeEmployeeSnapshot(employeeId, date);
+      await db.execute(
+        `INSERT INTO employee_performance_daily_snapshot
+           (id, employee_id, snapshot_date, attendance_status, late_by_minutes, unplanned_leave_flag,
+            pip_status, designation_id, quality_score, template_metrics,
+            team_attrition_pct, team_shrinkage_pct, team_revenue)
+         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
+         ON DUPLICATE KEY UPDATE
+           attendance_status = VALUES(attendance_status),
+           late_by_minutes = VALUES(late_by_minutes),
+           unplanned_leave_flag = VALUES(unplanned_leave_flag),
+           pip_status = VALUES(pip_status),
+           designation_id = VALUES(designation_id),
+           quality_score = VALUES(quality_score),
+           template_metrics = VALUES(template_metrics),
+           team_attrition_pct = VALUES(team_attrition_pct),
+           team_shrinkage_pct = VALUES(team_shrinkage_pct),
+           team_revenue = VALUES(team_revenue),
+           updated_at = CURRENT_TIMESTAMP`,
+        [
+          randomUUID(),
+          snapshot.employeeId,
+          snapshot.snapshotDate,
+          snapshot.attendanceStatus,
+          snapshot.lateByMinutes,
+          snapshot.unplannedLeaveFlag ? 1 : 0,
+          snapshot.pipStatus,
+          snapshot.designationId,
+          snapshot.qualityScore,
+          snapshot.templateMetrics ? JSON.stringify(snapshot.templateMetrics) : null,
+          snapshot.teamAttritionPct,
+          snapshot.teamShrinkagePct,
+          snapshot.teamRevenue,
+        ],
+      );
+      written += 1;
+    } catch (err) {
+      const message = err instanceof Error ? err.message : String(err);
+      console.error(
+        `[performance-scorecard-snapshot] failed to write snapshot for employeeId=${employeeId}:`,
+        err,
+      );
+      errors.push({ employeeId, error: message });
+    }
   }
-  return { written };
+  return { written, errors };
 }
