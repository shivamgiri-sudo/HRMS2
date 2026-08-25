STAT:
commit ae7341bb4fd88e642e9bbcd268aea1514b96ffef
Author: Shivam Giri <shivamgiri@users.noreply.github.com>
Date:   Tue Aug 25 04:49:01 2026 +0530

    feat: add RBAC-scoped GET /api/performance-scorecard route
    
    Role list matches dashboardAccessRegistry.ts's PERFORMANCE_SCORECARD
    allowedRoleKeys exactly (manager, process_manager, assistant_manager,
    branch_head, branch_manager, team_leader, tl, hr, hr_admin, ho_hr,
    branch_hr, process_hr, ceo, coo, management, super_admin) per Task 5's
    2026-08-22 fix. admin and wfm deliberately excluded.
    
    Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

 backend/src/app.ts                                 |  2 +
 .../__tests__/performance-scorecard.routes.test.ts | 99 ++++++++++++++++++++++
 .../performance-scorecard.routes.ts                | 97 +++++++++++++++++++++
 3 files changed, 198 insertions(+)

FULL DIFF:
commit ae7341bb4fd88e642e9bbcd268aea1514b96ffef
Author: Shivam Giri <shivamgiri@users.noreply.github.com>
Date:   Tue Aug 25 04:49:01 2026 +0530

    feat: add RBAC-scoped GET /api/performance-scorecard route
    
    Role list matches dashboardAccessRegistry.ts's PERFORMANCE_SCORECARD
    allowedRoleKeys exactly (manager, process_manager, assistant_manager,
    branch_head, branch_manager, team_leader, tl, hr, hr_admin, ho_hr,
    branch_hr, process_hr, ceo, coo, management, super_admin) per Task 5's
    2026-08-22 fix. admin and wfm deliberately excluded.
    
    Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

diff --git a/backend/src/app.ts b/backend/src/app.ts
index 2e45c8ac..47b13eca 100644
--- a/backend/src/app.ts
+++ b/backend/src/app.ts
@@ -86,30 +86,31 @@ import { assetsRouter } from "./modules/assets/assets.routes.js";
 import { exitPassRouter } from "./modules/assets/exit-pass.routes.js";
 import { filesRouter } from "./modules/files/files.routes.js";
 import { employeeDocsRouter } from "./modules/employees/employee.documents.routes.js";
 import { helpdeskRouter } from "./modules/helpdesk/helpdesk.routes.js";
 import { uatPipelineRouter } from "./modules/uat-pipeline/uat-pipeline.routes.js";
 import { uatInternalRouter } from "./modules/uat-pipeline/uat-internal.routes.js";
 import { lettersRouter } from "./modules/letters/letters.routes.js";
 import { publicJoiningKitRouter, joiningKitRouter } from "./modules/employees/joiningKit.routes.js";
 import { appointmentEsignRouter } from "./modules/letters/appointment-esign.routes.js";
 import { dscConfigRouter } from "./modules/letters/dscConfig.routes.js";
 import { notificationRecipientsRouter } from "./modules/it-provisioning/notification-recipients.routes.js";
 import { appointmentLetterRouter } from "./modules/letters/appointmentLetter.routes.js";
 import { atsExtRouter } from "./modules/ats-extensions/ats-ext.routes.js";
 import { wfmExtRouter } from "./modules/wfm-extensions/wfm-ext.routes.js";
 import { managementRouter } from "./modules/management/management.routes.js";
+import performanceScorecardRoutes from "./modules/performance-scorecard/performance-scorecard.routes.js";
 import { dailyBriefRouter } from "./modules/management/daily-brief/daily-brief.routes.js";
 import { rosterGovRouter } from "./modules/roster/roster.governance.routes.js";
 import { weekoffPreferenceRouter } from "./modules/roster/weekoff-preference.routes.js";
 import { rosterSelfSecureRouter } from "./modules/roster/roster.self.secure.routes.js";
 import { rtaRouter } from "./modules/rta/rta.routes.js";
 import { accountControlRouter } from "./modules/account-control/account.control.routes.js";
 import { workforceMandateRouter } from "./modules/workforce-mandate/workforce.mandate.routes.js";
 import { lmsRouter } from "./modules/lms/lms.routes.js";
 import { lmsIntegrationRouter } from "./modules/lms-integration/lms-integration.routes.js";
 import { benefitsRouter } from "./modules/benefits/benefits.routes.js";
 import { careerRouter } from "./modules/career/career.routes.js";
 import ijpRouter from "./modules/ijp/ijp.routes.js";
 import { erpRouter } from "./modules/erp/erp.routes.js";
 import { clientBillingRouter } from "./modules/client-billing/client-billing.routes.js";
 import { inboxRouter } from "./modules/inbox/inbox.routes.js";
@@ -504,30 +505,31 @@ app.use("/api/uat", uatPipelineRouter);
 // they are, until all eight gates in uat_gate_status are attested. See uat-internal.routes.ts.
 app.use("/api/uat-internal", uatInternalRouter);
 app.use("/api/letters", lettersRouter);
 app.use("/api/letters", appointmentEsignRouter);
 // Company signing certificate — super_admin only, handles private key material.
 app.use("/api/signing", dscConfigRouter);
 // Who receives each branch's provisioning notifications. Super-admin only —
 // it decides who is told about every new joiner, company-wide.
 app.use("/api/notification-recipients", notificationRecipientsRouter);
 // Payroll HR issuance. Separate from appointment-esign.routes.ts, which is
 // admin/hr only and sits on a table with two competing schemas.
 app.use("/api/letters", appointmentLetterRouter);
 app.use("/api/wfm-ext", wfmExtRouter);
 app.use("/api/management", managementRouter);
 app.use("/api/management", managementCommandCenterRouter);
+app.use("/api/performance-scorecard", performanceScorecardRoutes);
 // Phase B (MVP) D-1 Daily Manager Intelligence Briefing Engine — preview-only, dry-run,
 // no scheduler/cron wiring yet. See modules/management/daily-brief/.
 app.use("/api/management/daily-brief", dailyBriefRouter);
 app.use("/api/roster-gov", rosterSelfSecureRouter);
 app.use("/api/roster-gov", weekoffPreferenceRouter);
 app.use("/api/roster-gov", rosterGovRouter);
 app.use("/api/rta", rtaRouter);
 app.use("/api/account-control", accountControlRouter);
 app.use("/api/workforce-mandate", workforceMandateRouter);
 app.use("/api/lms", lmsIntegrationRouter);
 app.use("/api/lms", lmsRouter);
 app.use("/api/benefits", benefitsRouter);
 app.use("/api/career", careerRouter);
 app.use("/api/ijp", ijpRouter);
 app.use("/api/erp", erpRouter);
diff --git a/backend/src/modules/performance-scorecard/__tests__/performance-scorecard.routes.test.ts b/backend/src/modules/performance-scorecard/__tests__/performance-scorecard.routes.test.ts
new file mode 100644
index 00000000..83e803b7
--- /dev/null
+++ b/backend/src/modules/performance-scorecard/__tests__/performance-scorecard.routes.test.ts
@@ -0,0 +1,99 @@
+import express from "express";
+import request from "supertest";
+import { beforeEach, describe, expect, it, vi } from "vitest";
+
+/**
+ * Task 7: GET /api/performance-scorecard — RBAC-scoped route over
+ * employee_performance_daily_snapshot (Task 1's table).
+ *
+ * Role list is security-sensitive: matches dashboardAccessRegistry.ts's
+ * PERFORMANCE_SCORECARD.allowedRoleKeys exactly. Deliberately excludes
+ * "admin" and "wfm" — see Task 5's 2026-08-22 production-incident fix
+ * (dashboard-access-registry.test.ts) restricting admin to
+ * EMPLOYEE_SELF_DASHBOARD only, and PERFORMANCE_SCORECARD's registry entry
+ * not including wfm.
+ */
+
+const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
+vi.mock("../../../db/mysql.js", () => ({
+  db: { execute, query: execute, getConnection: vi.fn() },
+}));
+
+vi.mock("../../../shared/accessGuard.js", () => ({
+  hasRole: vi.fn(async (_userId: string, ...roles: string[]) =>
+    roles.some((r) => ["manager"].includes(r))
+  ),
+  getEmployeeForUser: vi.fn(async () => ({ id: "emp-mgr-1" })),
+}));
+
+vi.mock("../../management/management.service.js", () => ({
+  managementService: {
+    getDirectReportIds: vi.fn(async () => ["emp-report-1"]),
+  },
+}));
+
+let actorRoles: string[] = ["manager"];
+vi.mock("../../../middleware/authMiddleware.js", async (importOriginal) => {
+  const original = await importOriginal<typeof import("../../../middleware/authMiddleware.js")>();
+  return {
+    ...original,
+    requireAuth: (req: any, _res: any, next: any) => {
+      req.authUser = { id: "u-mgr-1", role: actorRoles[0], roles: actorRoles };
+      next();
+    },
+  };
+});
+
+import performanceScorecardRoutes from "../performance-scorecard.routes.js";
+
+function app() {
+  const a = express();
+  a.use(express.json());
+  a.use("/api/performance-scorecard", performanceScorecardRoutes);
+  return a;
+}
+
+beforeEach(() => {
+  execute.mockReset().mockResolvedValue([[], []]);
+  actorRoles = ["manager"];
+});
+
+describe("GET /api/performance-scorecard", () => {
+  it("returns snapshot rows scoped to the caller's manager chain", async () => {
+    execute.mockResolvedValueOnce([
+      [
+        {
+          employeeId: "emp-1",
+          employeeName: "Test Employee",
+          employeeCode: "EMP-1",
+          snapshotDate: "2026-08-24",
+          attendanceStatus: "present",
+        },
+      ],
+      [],
+    ]);
+
+    const res = await request(app())
+      .get("/api/performance-scorecard")
+      .query({ dateFrom: "2026-08-01", dateTo: "2026-08-24" });
+
+    expect(res.status).toBe(200);
+    expect(res.body.success).toBe(true);
+    expect(res.body.data).toHaveLength(1);
+    expect(res.body.data[0].employeeId).toBe("emp-1");
+  });
+
+  it("returns 400 when dateFrom or dateTo is missing", async () => {
+    const res = await request(app()).get("/api/performance-scorecard");
+    expect(res.status).toBe(400);
+    expect(res.body.success).toBe(false);
+  });
+
+  it("a role with no grant at all gets 403", async () => {
+    actorRoles = ["employee"];
+    const res = await request(app())
+      .get("/api/performance-scorecard")
+      .query({ dateFrom: "2026-08-01", dateTo: "2026-08-24" });
+    expect(res.status).toBe(403);
+  });
+});
diff --git a/backend/src/modules/performance-scorecard/performance-scorecard.routes.ts b/backend/src/modules/performance-scorecard/performance-scorecard.routes.ts
new file mode 100644
index 00000000..15e4c5ec
--- /dev/null
+++ b/backend/src/modules/performance-scorecard/performance-scorecard.routes.ts
@@ -0,0 +1,97 @@
+import { Router } from "express";
+import type { Response } from "express";
+import { requireAuth } from "../../middleware/authMiddleware.js";
+import { requireRole } from "../../middleware/requireRole.js";
+import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
+import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
+import { managementService } from "../management/management.service.js";
+import { db } from "../../db/mysql.js";
+
+const router = Router();
+// eslint-disable-next-line @typescript-eslint/no-explicit-any
+const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);
+router.use(requireAuth);
+
+/**
+ * Resolve scoped employee ID list for non-admin/hr/ceo/qa roles.
+ * Mirrors management.routes.ts's resolveTeamScope (not exported from there,
+ * so replicated here rather than imported — see task-7-report.md).
+ * Admins, HR, CEO, QA see everyone. Managers/TLs see only their direct reports.
+ * Returns null if the caller has no employee record (block the request).
+ * Returns [] if the manager has no reports yet (no data returned).
+ */
+async function resolveTeamScope(userId: string): Promise<{ employeeIds: string[] | null; isWide: boolean }> {
+  if (await hasRole(userId, "admin", "hr", "ceo", "qa")) {
+    return { employeeIds: null, isWide: true };
+  }
+  const emp = await getEmployeeForUser(userId);
+  if (!emp) return { employeeIds: null, isWide: false };
+  const ids = await managementService.getDirectReportIds(emp.id);
+  if (!ids.includes(emp.id)) ids.push(emp.id);
+  return { employeeIds: ids, isWide: false };
+}
+
+/**
+ * Role list is SECURITY-SENSITIVE. Matches dashboardAccessRegistry.ts's
+ * PERFORMANCE_SCORECARD.allowedRoleKeys exactly (confirmed 2026-08-25).
+ * Deliberately excludes "admin" and "wfm" per Task 5's 2026-08-22
+ * production-incident fix — do not add them back without a security review.
+ */
+router.get(
+  "/",
+  requireRole(
+    "manager",
+    "process_manager",
+    "assistant_manager",
+    "branch_head",
+    "branch_manager",
+    "team_leader",
+    "tl",
+    "hr",
+    "hr_admin",
+    "ho_hr",
+    "branch_hr",
+    "process_hr",
+    "ceo",
+    "coo",
+    "management",
+    "super_admin",
+  ),
+  h(async (req: AuthenticatedRequest, res: Response) => {
+    const { dateFrom, dateTo } = req.query as { dateFrom?: string; dateTo?: string };
+    if (!dateFrom || !dateTo) {
+      return res.status(400).json({ success: false, message: "dateFrom and dateTo are required" });
+    }
+    const { employeeIds, isWide } = await resolveTeamScope(req.authUser!.id);
+    if (!isWide && employeeIds !== null && employeeIds.length === 0) {
+      return res.json({ success: true, data: [] });
+    }
+
+    const conds = ["s.snapshot_date BETWEEN ? AND ?"];
+    const params: unknown[] = [dateFrom, dateTo];
+    if (!isWide && employeeIds && employeeIds.length > 0) {
+      conds.push(`s.employee_id IN (${employeeIds.map(() => "?").join(",")})`);
+      params.push(...employeeIds);
+    }
+
+    const [rows] = (await db.execute(
+      `SELECT e.id AS employeeId, e.full_name AS employeeName, e.employee_code AS employeeCode,
+              s.snapshot_date AS snapshotDate, s.attendance_status AS attendanceStatus,
+              s.late_by_minutes AS lateByMinutes, s.unplanned_leave_flag AS unplannedLeaveFlag,
+              s.pip_status AS pipStatus, s.designation_id AS designationId,
+              s.quality_score AS qualityScore, s.template_metrics AS templateMetrics,
+              s.team_attrition_pct AS teamAttritionPct, s.team_shrinkage_pct AS teamShrinkagePct,
+              s.team_revenue AS teamRevenue
+         FROM employee_performance_daily_snapshot s
+         JOIN employees e ON e.id = s.employee_id
+        WHERE ${conds.join(" AND ")}
+        ORDER BY e.full_name ASC, s.snapshot_date ASC
+        LIMIT 5000`,
+      params,
+    )) as any;
+
+    res.json({ success: true, data: rows });
+  }),
+);
+
+export default router;
