commit 0b677867562eacb5fcb784e7755a56899282c16f
Author: Shivam Giri <shivamgiri@users.noreply.github.com>
Date:   Tue Aug 25 07:55:27 2026 +0530

    fix: fail closed (403) when team scope cannot be resolved in performance scorecard route

diff --git a/backend/src/modules/performance-scorecard/__tests__/performance-scorecard.routes.test.ts b/backend/src/modules/performance-scorecard/__tests__/performance-scorecard.routes.test.ts
index 83e803b7..550c8337 100644
--- a/backend/src/modules/performance-scorecard/__tests__/performance-scorecard.routes.test.ts
+++ b/backend/src/modules/performance-scorecard/__tests__/performance-scorecard.routes.test.ts
@@ -1,18 +1,20 @@
 import express from "express";
 import request from "supertest";
 import { beforeEach, describe, expect, it, vi } from "vitest";
+import { getEmployeeForUser } from "../../../shared/accessGuard.js";
+import { managementService } from "../../management/management.service.js";
 
 /**
  * Task 7: GET /api/performance-scorecard — RBAC-scoped route over
  * employee_performance_daily_snapshot (Task 1's table).
  *
  * Role list is security-sensitive: matches dashboardAccessRegistry.ts's
  * PERFORMANCE_SCORECARD.allowedRoleKeys exactly. Deliberately excludes
  * "admin" and "wfm" — see Task 5's 2026-08-22 production-incident fix
  * (dashboard-access-registry.test.ts) restricting admin to
  * EMPLOYEE_SELF_DASHBOARD only, and PERFORMANCE_SCORECARD's registry entry
  * not including wfm.
  */
 
 const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
 vi.mock("../../../db/mysql.js", () => ({
@@ -84,16 +86,39 @@ describe("GET /api/performance-scorecard", () => {
   });
 
   it("returns 400 when dateFrom or dateTo is missing", async () => {
     const res = await request(app()).get("/api/performance-scorecard");
     expect(res.status).toBe(400);
     expect(res.body.success).toBe(false);
   });
 
   it("a role with no grant at all gets 403", async () => {
     actorRoles = ["employee"];
     const res = await request(app())
       .get("/api/performance-scorecard")
       .query({ dateFrom: "2026-08-01", dateTo: "2026-08-24" });
     expect(res.status).toBe(403);
   });
+
+  it("fails closed with 403 when the caller has no employee record and no org-wide role", async () => {
+    vi.mocked(getEmployeeForUser).mockResolvedValueOnce(null as unknown as { id: string });
+
+    const res = await request(app())
+      .get("/api/performance-scorecard")
+      .query({ dateFrom: "2026-08-01", dateTo: "2026-08-24" });
+
+    expect(res.status).toBe(403);
+    expect(res.body.success).toBe(false);
+  });
+
+  it("returns 200 with an empty array when the manager's resolved team has no members", async () => {
+    vi.mocked(managementService.getDirectReportIds).mockResolvedValueOnce([]);
+    execute.mockResolvedValueOnce([[], []]);
+
+    const res = await request(app())
+      .get("/api/performance-scorecard")
+      .query({ dateFrom: "2026-08-01", dateTo: "2026-08-24" });
+
+    expect(res.status).toBe(200);
+    expect(res.body).toEqual({ success: true, data: [] });
+  });
 });
diff --git a/backend/src/modules/performance-scorecard/performance-scorecard.routes.ts b/backend/src/modules/performance-scorecard/performance-scorecard.routes.ts
index 15e4c5ec..ad3edf7c 100644
--- a/backend/src/modules/performance-scorecard/performance-scorecard.routes.ts
+++ b/backend/src/modules/performance-scorecard/performance-scorecard.routes.ts
@@ -51,30 +51,36 @@ router.get(
     "hr_admin",
     "ho_hr",
     "branch_hr",
     "process_hr",
     "ceo",
     "coo",
     "management",
     "super_admin",
   ),
   h(async (req: AuthenticatedRequest, res: Response) => {
     const { dateFrom, dateTo } = req.query as { dateFrom?: string; dateTo?: string };
     if (!dateFrom || !dateTo) {
       return res.status(400).json({ success: false, message: "dateFrom and dateTo are required" });
     }
     const { employeeIds, isWide } = await resolveTeamScope(req.authUser!.id);
+    if (!isWide && employeeIds === null) {
+      return res.status(403).json({
+        success: false,
+        message: "Unable to resolve your team scope — no employee record or organization-wide role found",
+      });
+    }
     if (!isWide && employeeIds !== null && employeeIds.length === 0) {
       return res.json({ success: true, data: [] });
     }
 
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
