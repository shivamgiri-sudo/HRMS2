import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import * as svc from "./kpi-scorecard.service.js";

const router = Router();
type AsyncHandler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const h = (fn: AsyncHandler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};

// Same viewer set as process-performance.routes.ts -- kept identical so a role
// that can open Process Performance can also open this sibling dashboard.
const VIEWER_ROLES = [
  "admin", "ceo", "coo", "manager", "process_manager", "operations_manager",
  "branch_head", "qa", "quality_analyst", "tq_head",
] as const;

/** Same local-date default as process-performance.routes.ts -- see that file for the IST/toISOString trap this avoids. */
function readFilters(req: AuthenticatedRequest): svc.KpiFilters {
  const q = req.query as Record<string, string | undefined>;
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { from: q.from || iso(firstOfMonth), to: q.to || iso(today) };
}

// Literal routes before ":processCode"-shaped routes -- Express matches in
// registration order, same trap process-performance.routes.ts documents.
router.get("/processes", requireAuth, requireRole(...VIEWER_ROLES), h(async (_req, res) => {
  res.json({ success: true, data: svc.listRegisteredProcesses() });
}));

router.get("/:processCode/header", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await svc.getProcessKpiHeader(req.authUser!.id, req.params.processCode);
  if (!data) return res.status(404).json({ success: false, code: "PROCESS_NOT_FOUND", message: "Unknown process, or outside your scope." });
  res.json({ success: true, data });
}));

router.get("/:processCode/scorecards", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await svc.getKpiScorecards(req.authUser!.id, req.params.processCode, readFilters(req));
  res.json({ success: true, data });
}));

router.get("/:processCode/detail/:metricKey", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const data = await svc.getKpiMetricDetail(
    req.authUser!.id, req.params.processCode, req.params.metricKey, readFilters(req),
    q.teamLeaderId || null, q.employeeId || null,
  );
  if (!data) return res.status(404).json({ success: false, code: "UNKNOWN_METRIC", message: "Unknown metric for this process." });
  res.json({ success: true, data });
}));

export const kpiScorecardRouter = router;
export default router;
