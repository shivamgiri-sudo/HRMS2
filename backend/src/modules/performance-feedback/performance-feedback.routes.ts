import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
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
router.patch("/development-plans/:planId/goals/:goalId", h(c.updateGoal));
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
