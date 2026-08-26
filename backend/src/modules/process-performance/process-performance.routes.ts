import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import * as svc from "./process-performance.service.js";

const router = Router();
type AsyncHandler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const h = (fn: AsyncHandler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};

/**
 * Who may open the Process Performance report card.
 *
 * super_admin is deliberately absent: requireRole short-circuits for it, so
 * listing it would be redundant. Scoping is NOT done by this list -- every
 * handler re-derives the caller's scope inside the service via
 * buildScopeWhereClause, so holding process_manager does not by itself reveal
 * any process. That is what makes the drill-down safe at depth: a manager who
 * guesses another manager's id still gets their own scope's rows, because the
 * predicate is applied in SQL rather than by trusting the id in the URL.
 */
const VIEWER_ROLES = [
  "admin", "ceo", "coo", "manager", "process_manager", "operations_manager",
  "branch_head", "qa", "quality_analyst", "tq_head",
] as const;

/** Dates default to the current month rather than erroring, so the page loads unparameterised. */
function readFilters(req: AuthenticatedRequest): svc.PerfFilters {
  const q = req.query as Record<string, string | undefined>;
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return {
    from: q.from || iso(firstOfMonth),
    to: q.to || iso(today),
    processId: q.processId || null,
    managerId: q.managerId || null,
  };
}

const SECTION_KEYS: svc.SectionKey[] = [
  "headcount", "mandate", "buffer", "shrinkage", "attrition",
  "quality", "operations", "hygiene", "late_comers", "pnl",
];

// Literal routes are declared before any ":id"-style route in this file. Express
// matches in registration order, so a later wildcard would swallow these -- the
// same trap that made /my-processes need its own ordering test.
router.get("/processes", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await svc.getProcessRows(req.authUser!.id, readFilters(req));
  res.json({ success: true, data });
}));

router.get("/managers", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const filters = readFilters(req);
  if (!filters.processId) {
    return res.status(400).json({ success: false, code: "PROCESS_REQUIRED", message: "processId is required for manager rows." });
  }
  const data = await svc.getManagerRows(req.authUser!.id, filters);
  res.json({ success: true, data });
}));

router.get("/agents", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const filters = readFilters(req);
  if (!filters.managerId) {
    return res.status(400).json({ success: false, code: "MANAGER_REQUIRED", message: "managerId is required for agent rows." });
  }
  const data = await svc.getAgentRows(req.authUser!.id, filters);
  res.json({ success: true, data });
}));

router.get("/detail/:section", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const section = req.params.section as svc.SectionKey;
  if (!SECTION_KEYS.includes(section)) {
    return res.status(400).json({ success: false, code: "UNKNOWN_SECTION", message: `Unknown section '${section}'.` });
  }
  const data = await svc.getMetricDetail(req.authUser!.id, section, readFilters(req));
  res.json({ success: true, data });
}));

export const processPerformanceRouter = router;
export default router;
