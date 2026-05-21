import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { kpiController as c } from "./kpi.controller.js";

const router = Router();
const h = (fn: Function) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

// Metrics
router.get("/metrics", h(c.listMetrics));
router.post("/metrics", h(c.createMetric));

// Templates
router.get("/templates", h(c.listTemplates));
router.post("/templates", h(c.createTemplate));
router.get("/templates/:id/metrics", h(c.listTemplateMetrics));
router.post("/templates/:id/metrics", h(c.addTemplateMetric));

// Assignments — static path before dynamic
router.post("/assignments", h(c.assignTemplate));
router.get("/assignments/employee/:employeeId", h(c.getEmployeeTemplate));

// Scores — static path before dynamic
router.post("/scores/bulk", h(c.bulkRecordScores));
router.post("/scores", h(c.recordScore));

// Summary + Leaderboard
router.get("/summary/:employeeId/:templateId/:period", h(c.getEmployeeSummary));
router.get("/leaderboard", h(c.getLeaderboard));

export { router as kpiRouter };
