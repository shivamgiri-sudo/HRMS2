import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getDalmiaDashboard } from "./dalmia-dashboard.service.js";

const router = Router();
const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);

router.use(requireAuth);

/** Same viewer roles every Process Performance V2 dashboard already gates on. */
const VIEWER_ROLES = [
  "admin", "ceo", "coo", "manager", "process_manager", "operations_manager",
  "branch_head", "qa", "quality_analyst", "tq_head",
];

router.get("/dalmia-dashboard", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await getDalmiaDashboard(
    req.query.month ? String(req.query.month) : undefined,
    req.query.from ? String(req.query.from) : undefined,
    req.query.to ? String(req.query.to) : undefined,
  );
  res.json({ success: true, data });
}));

export { router as dalmiaDashboardRouter };
