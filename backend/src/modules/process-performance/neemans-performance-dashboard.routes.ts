import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getNeemansPerformanceDashboard, getChatData } from "./neemans-performance-dashboard.service.js";

const router = Router();
const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);

router.use(requireAuth);

const VIEWER_ROLES = [
  "admin", "ceo", "coo", "manager", "process_manager", "operations_manager",
  "branch_head", "qa", "quality_analyst", "tq_head",
];

router.get("/neemans-performance-dashboard", requireRole(...VIEWER_ROLES), h(async (_req, res) => {
  const data = await getNeemansPerformanceDashboard();
  res.json({ success: true, data });
}));

/**
 * Chat alone, as its own standalone LOB dashboard (like Inbound/Cart
 * already are) rather than only reachable as one tab inside the combined
 * Sale/Allocation/Chat/Productivity view -- same getChatData() aggregate,
 * just callable on its own so a Chat-focused view doesn't have to also
 * compute Sale/Allocation (57k+ allocation rows) to load.
 */
router.get("/neemans-chat-dashboard", requireRole(...VIEWER_ROLES), h(async (_req, res) => {
  const data = await getChatData();
  res.json({ success: true, data });
}));

export { router as neemansPerformanceDashboardRouter };
