import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { performanceFeedbackController as c } from "./performance-feedback.controller.js";
import {
  getEmployeeQualityMetrics,
  getEmployeeQualityTrend,
  getTeamQualityMetrics
} from "./quality-data.service.js";

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
// GET /api/performance-feedback/quality/:employeeCode - Get quality metrics for employee
router.get("/quality/:employeeCode", h(async (req: any, res: any) => {
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
router.get("/quality/:employeeCode/trend", h(async (req: any, res: any) => {
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
router.post("/quality/team", h(async (req: any, res: any) => {
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

export { router as performanceFeedbackRouter };
