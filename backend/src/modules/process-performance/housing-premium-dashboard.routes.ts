import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getHousingPremiumDashboard } from "./housing-premium-dashboard.service.js";

const router = Router();
const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);

router.use(requireAuth);

const VIEWER_ROLES = [
  "admin", "ceo", "coo", "manager", "process_manager", "operations_manager",
  "branch_head", "qa", "quality_analyst", "tq_head",
];

router.get("/housing-premium-dashboard", requireRole(...VIEWER_ROLES), h(async (_req, res) => {
  const data = await getHousingPremiumDashboard();
  res.json({ success: true, data });
}));

export { router as housingPremiumDashboardRouter };
