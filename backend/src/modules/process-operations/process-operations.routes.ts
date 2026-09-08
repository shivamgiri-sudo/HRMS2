import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import * as svc from "./process-operations.service.js";
import { getFeedHealth } from "./feed-health.service.js";

/**
 * Process Operations HTTP surface.
 *
 * Read-only. The role gate decides who may reach these routes; it is not the data
 * boundary. Which processes a caller can see is resolved inside the service from
 * their own scope, so a process id guessed in the URL returns 404 rather than
 * another team's numbers.
 */

const router = Router();
type AsyncHandler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const h = (fn: AsyncHandler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};

const VIEWER_ROLES = [
  "super_admin", "admin", "ceo", "coo", "manager", "process_manager",
  "operations_manager", "branch_head", "qa", "quality_analyst", "tq_head",
  "hr", "team_leader",
] as const;

router.get("/processes", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  res.json({ success: true, data: await svc.listProcesses(req.authUser!.id) });
}));

/**
 * Declared BEFORE /:processId, or Express matches "feeds" as a process id and
 * this route becomes unreachable — the same shadowing that left an exit-status
 * guard 100% dead in this codebase.
 */
router.get("/feeds", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const allowed = await svc.readableProcessIds(req.authUser!.id);
  res.json({ success: true, data: await getFeedHealth(allowed) });
}));

/**
 * Drill-down for one metric on one process: the formula, the source and its
 * filters, every daily reading with its parts, and who defined it.
 *
 * Declared before /:processId so the two-segment path is not swallowed by the
 * one-segment route.
 */
router.get("/:processId/metric/:metricKey", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const days = Number(req.query.days);
  const windowDays = Number.isFinite(days) ? Math.min(Math.max(Math.trunc(days), 7), 120) : 30;
  const data = await svc.getMetricDrilldown(
    req.authUser!.id, req.params.processId, req.params.metricKey, windowDays);
  if (!data) {
    return res.status(404).json({
      success: false, code: "NOT_FOUND",
      message: "No such process or metric, or it is outside your access.",
    });
  }
  res.json({ success: true, data });
}));

router.get("/:processId", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const days = Number(req.query.days);
  // Clamped rather than trusted: an unbounded window here is a full-table scan
  // per metric, and the page only ever asks for a month.
  const windowDays = Number.isFinite(days) ? Math.min(Math.max(Math.trunc(days), 7), 90) : 30;
  const data = await svc.getProcessOperations(req.authUser!.id, req.params.processId, windowDays);
  if (!data) {
    return res.status(404).json({
      success: false, code: "NOT_FOUND",
      message: "No such process, or it is outside your access.",
    });
  }
  res.json({ success: true, data });
}));

export { router as processOperationsRouter };
