import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";
import { hasAnyRole, hasScopedAccess } from "../../shared/scopeAccess.js";
import { performanceFeedbackController as c } from "./performance-feedback.controller.js";
import {
  getEmployeeQualityMetrics,
  getEmployeeQualityTrend,
  getTeamQualityMetrics
} from "./quality-data.service.js";
import { importQualityRows } from "./quality-upload.service.js";

const router = Router();

// Helper to wrap async route handlers
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

// Apply authentication middleware to all routes
router.use(requireAuth);

// ================== Cycle Management (5 routes) ==================
router.post("/cycles", requireRole("admin", "hr"), h(c.createCycle));
router.get("/cycles", h(c.getCycles));
router.get("/cycles/:id", h(c.getCycleById));
router.patch("/cycles/:id", requireRole("admin", "hr"), h(c.updateCycle));
router.post("/cycles/:id/close", requireRole("admin", "hr"), h(c.closeCycle));

// ================== Request Management (4 routes) ==================
router.post("/cycles/:cycleId/launch", requireRole("admin", "hr"), h(c.launchCycle));
router.get("/requests", h(c.getRequests));
router.get("/requests/:id", h(c.getRequestById));
router.delete("/requests/:id", requireRole("admin", "hr"), h(c.deleteRequest));

// ================== Competency Management (4 routes) ==================
router.get("/competencies", h(c.getCompetencies));
router.post("/competencies", requireRole("admin", "hr"), h(c.createCompetency));
router.patch("/competencies/:id", requireRole("admin", "hr"), h(c.updateCompetency));
router.delete("/competencies/:id", requireRole("admin", "hr"), h(c.deactivateCompetency));

// ================== Feedback Submission (2 routes) ==================
router.get("/requests/:id/form", h(c.getFormTemplate));
router.post("/requests/:id/submit", h(c.submitFeedback));

// ================== Report & Development Plans (9 routes) ==================
router.post("/requests/:id/report", requireRole("admin", "hr"), h(c.generateReport));
router.get("/reports", h(c.getReports));
router.get("/reports/:id", h(c.getReportById));
router.post("/development-plans", requireRole("admin", "hr", "manager"), h(c.createDevelopmentPlan));
router.get("/development-plans", h(c.getDevelopmentPlans));
router.get("/development-plans/:id", h(c.getDevelopmentPlanById));
router.patch("/development-plans/:id", requireRole("admin", "hr", "manager"), h(c.updateDevelopmentPlan));
// Had no requireRole at all — the frontend (NativePerformanceFeedbackDevelopmentPlan.tsx)
// gates its Start/Mark-Complete buttons behind isManager client-side only, but the route
// accepted the PATCH from any authenticated user. Matched to the sibling create route's
// role list. Fixed 2026-09-01.
router.patch("/development-plans/:planId/goals/:goalId", requireRole("admin", "hr", "manager"), h(c.updateGoal));
router.delete("/development-plans/:id", requireRole("admin", "hr"), h(c.deleteDevelopmentPlan));

// ================== Quality Data Integration (3 routes) ==================
// These three read call-audit quality scores for arbitrary employee codes — the two
// :employeeCode routes take whatever code is in the path, and /quality/team takes an
// unbounded array in the body. They carried only requireAuth, and the service applies no
// scope of its own (getTeamQualityMetrics queries straight on the codes it is handed), so
// any employee with a login could read any colleague's audit scores. The write beside them,
// /quality/upload, has been requireRole("admin","hr","qa") all along — these reads were the
// odd ones out.
//
// Roles are the union of the audience the nav already assigns to "Team Quality"
// (super_admin/admin/manager/process_manager/branch_head/team_leader) and the quality owners
// on /quality/upload (hr, qa). super_admin passes implicitly inside requireRole.
//
// Residual, deliberately not fixed here: a permitted role can still request codes outside
// their own team, because these endpoints have no row scope at all. Adding one is a scoping
// decision (which relationship defines "my team") rather than a mechanical change, and no
// caller exists yet to model it on — no frontend calls any of the three; the /quality/team
// path in the router is a UI route that redirects to /quality-dashboard, not this API.
const QUALITY_READ_ROLES = ["admin", "hr", "qa", "manager", "process_manager", "branch_head", "team_leader"] as const;

// Row scope, closing the residual the role guard above deliberately left open.
//
// Org-wide roles read anyone; a scoped role may read only the people they actually own.
// Ownership is EITHER relationship, because neither covers the live data on its own:
// 8 of 67 scoped-role users hold no user_assignment_scope row (4 of 9 branch_heads), while
// 965 of 1,127 active employees carry a reporting_manager_id. Requiring an assignment row
// alone would 403 real managers; relying on the manager link alone would lock out
// branch/process owners who do not directly manage the people in their scope.
const QUALITY_GLOBAL_ROLES = ["admin", "hr", "qa"];
const QUALITY_SCOPED_ROLES = ["manager", "process_manager", "branch_head", "team_leader"];

/**
 * Returns the subset of employee codes the caller may NOT read. Fail-closed: a code that
 * resolves to no employee row is denied rather than passed through, because the quality
 * database is keyed on its own `User` column and would otherwise answer for a code that
 * exists there but not in mas_hrms.
 */
async function deniedQualityCodes(userId: string, codes: string[]): Promise<string[]> {
  const wanted = [...new Set(codes.map((x) => String(x).trim()).filter(Boolean))];
  if (wanted.length === 0) return [];
  if (await hasAnyRole(userId, "super_admin", ...QUALITY_GLOBAL_ROLES)) return [];

  const ph = wanted.map(() => "?").join(",");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.employee_code, e.branch_id, e.process_id, e.reporting_manager_id,
            (SELECT id FROM employees WHERE user_id = ? LIMIT 1) AS caller_emp_id
       FROM employees e
      WHERE e.employee_code IN (${ph})`,
    [userId, ...wanted],
  );

  const allowed = new Set<string>();
  for (const r of rows as any[]) {
    const code = String(r.employee_code);
    if (r.caller_emp_id && r.reporting_manager_id && r.reporting_manager_id === r.caller_emp_id) {
      allowed.add(code);
      continue;
    }
    if (await hasScopedAccess(userId, QUALITY_SCOPED_ROLES, { branchId: r.branch_id, processId: r.process_id })) {
      allowed.add(code);
    }
  }
  return wanted.filter((code) => !allowed.has(code));
}

// GET /api/performance-feedback/quality/:employeeCode - Get quality metrics for employee
router.get("/quality/:employeeCode", requireRole(...QUALITY_READ_ROLES), h(async (req: any, res: any) => {
  const { employeeCode } = req.params;
  const { startDate, endDate } = req.query;

  if (!startDate || !endDate) {
    return res.status(400).json({
      success: false,
      error: "startDate and endDate query parameters are required"
    });
  }

  if ((await deniedQualityCodes(req.authUser!.id, [employeeCode])).length > 0) {
    return res.status(403).json({ success: false, error: "Forbidden: employee is outside your scope" });
  }

  const metrics = await getEmployeeQualityMetrics(employeeCode, startDate, endDate);

  if (!metrics) {
    return res.status(404).json({
      success: false,
      error: "No quality data found for this employee in the specified period"
    });
  }

  return res.json({ success: true, data: metrics });
}));

// GET /api/performance-feedback/quality/:employeeCode/trend - Get quality trend
router.get("/quality/:employeeCode/trend", requireRole(...QUALITY_READ_ROLES), h(async (req: any, res: any) => {
  const { employeeCode } = req.params;
  const { startDate, endDate } = req.query;

  if (!startDate || !endDate) {
    return res.status(400).json({
      success: false,
      error: "startDate and endDate query parameters are required"
    });
  }

  if ((await deniedQualityCodes(req.authUser!.id, [employeeCode])).length > 0) {
    return res.status(403).json({ success: false, error: "Forbidden: employee is outside your scope" });
  }

  const trend = await getEmployeeQualityTrend(employeeCode, startDate, endDate);

  return res.json({ success: true, data: trend });
}));

// POST /api/performance-feedback/quality/team - Get quality metrics for multiple employees
router.post("/quality/team", requireRole(...QUALITY_READ_ROLES), h(async (req: any, res: any) => {
  const { employeeCodes, startDate, endDate } = req.body;

  if (!employeeCodes || !Array.isArray(employeeCodes) || !startDate || !endDate) {
    return res.status(400).json({
      success: false,
      error: "employeeCodes (array), startDate, and endDate are required"
    });
  }

  // Refuse the whole request rather than silently returning a subset: a team scorecard
  // quietly missing three people reads as "those three have no audits", which is exactly
  // the kind of silent wrongness this codebase keeps producing. Name the count so the
  // caller can correct the list.
  const denied = await deniedQualityCodes(req.authUser!.id, employeeCodes);
  if (denied.length > 0) {
    return res.status(403).json({
      success: false,
      error: `Forbidden: ${denied.length} of ${employeeCodes.length} requested employees are outside your scope`,
    });
  }

  const metrics = await getTeamQualityMetrics(employeeCodes, startDate, endDate);

  return res.json({ success: true, data: metrics });
}));

// POST /api/performance-feedback/quality/upload — batch import quality audit rows
router.post("/quality/upload", requireRole("admin", "hr", "qa"), h(async (req: any, res: any) => {
  const rows = req.body?.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({
      success: false,
      error: "Body must contain a non-empty `rows` array of quality records",
    });
  }
  const result = await importQualityRows(rows, req.authUser?.id ?? "system");
  return res.json({ success: true, data: result });
}));

export { router as performanceFeedbackRouter };
