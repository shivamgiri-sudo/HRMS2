import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getNeemansCartDashboard } from "./neemans-cart-dashboard.service.js";

const router = Router();
const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);

router.use(requireAuth);

/** Same viewer role set the Bellavita/GNC sale dashboard routes use -- this
 * endpoint backs one dashboard on the same Process Performance V2 page. */
const VIEWER_ROLES = [
  "admin", "ceo", "coo", "manager", "process_manager", "operations_manager",
  "branch_head", "qa", "quality_analyst", "tq_head",
];

router.get("/neemans-cart-dashboard", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  // Defaults to the current month (1st .. today) when from/to are absent
  // or malformed -- getNeemansCartDashboard applies the same fallback
  // itself, so an invalid query string can never 500 or silently scan an
  // unbounded range.
  const from = String(req.query.from ?? "");
  const to = String(req.query.to ?? "");
  const data = await getNeemansCartDashboard(from, to);
  res.json({ success: true, data });
}));

export { router as neemansCartDashboardRouter };
