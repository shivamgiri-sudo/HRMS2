import { Router, type NextFunction, type Response } from "express";
import {
  requireAuth,
  type AuthenticatedRequest,
} from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getDalmiaAgentWise, getDalmiaDashboard } from "./dalmia-dashboard.service.js";

const router = Router();
const h =
  (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

router.use(requireAuth);

/** Same viewer roles every Process Performance V2 dashboard already gates on. */
const VIEWER_ROLES = [
  "admin",
  "ceo",
  "coo",
  "manager",
  "process_manager",
  "operations_manager",
  "branch_head",
  "qa",
  "quality_analyst",
  "tq_head",
];

router.get(
  "/dalmia-dashboard",
  requireRole(...VIEWER_ROLES),
  h(async (req, res) => {
    const data = await getDalmiaDashboard(
      req.query.month ? String(req.query.month) : undefined,
      req.query.from ? String(req.query.from) : undefined,
      req.query.to ? String(req.query.to) : undefined,
    );
    res.json({ success: true, data });
  }),
);

/**
 * Agent Wise Performance (DalmiaDashboard.tsx), from db_masmis.dalmia_apr_raw. tausif-mis 7d02a4ee4 added the
 * service function and the page's call but not this route. Same viewer roles as the dashboard itself; a missing
 * dalmia_apr_raw table (migration sql/1781 not applied) reads as "no agents" instead of failing the request.
 */
router.get("/dalmia-dashboard/agent-wise", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const from = req.query.from ? String(req.query.from) : "";
  const to = req.query.to ? String(req.query.to) : "";
  try {
    res.json({ success: true, data: await getDalmiaAgentWise(from, to) });
  } catch (err) {
    if ((err as { code?: string }).code !== "ER_NO_SUCH_TABLE") throw err;
    res.json({ success: true, data: { from, to, agents: [] } });
  }
}));

export { router as dalmiaDashboardRouter };
