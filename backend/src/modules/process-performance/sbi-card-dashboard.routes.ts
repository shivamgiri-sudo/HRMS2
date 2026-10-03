import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getSbiCardDashboard } from "./sbi-card-dashboard.service.js";
import { getSbiCardPayout } from "./sbi-card-payout.service.js";

const router = Router();
const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);

router.use(requireAuth);

/** Same viewer roles every Process Performance V2 dashboard already gates on. */
const VIEWER_ROLES = [
  "admin", "ceo", "coo", "manager", "process_manager", "operations_manager",
  "branch_head", "qa", "quality_analyst", "tq_head",
];

router.get("/sbi-card-dashboard", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await getSbiCardDashboard(
    req.query.month ? String(req.query.month) : undefined,
    req.query.from ? String(req.query.from) : undefined,
    req.query.to ? String(req.query.to) : undefined,
  );
  res.json({ success: true, data });
}));

/**
 * The payout is commercially sensitive (the process is 100% variable): manager and above only. Deliberately NOT under /sbi-card-dashboard,
 * so a TPZ process-access grant for the dashboard does not open it.
 */
const PAYOUT_ROLES = ["admin", "super_admin", "ceo", "coo", "manager", "operations_manager", "process_manager", "branch_head"];

router.get("/sbi-card-payout", requireRole(...PAYOUT_ROLES), h(async (req, res) => {
  const data = await getSbiCardPayout({
    month: req.query.month ? String(req.query.month) : undefined,
    from: req.query.from ? String(req.query.from) : undefined,
    to: req.query.to ? String(req.query.to) : undefined,
    res: req.query.res, nm: req.query.nm, rb: req.query.rb,
  });
  res.json({ success: true, data });
}));

export { router as sbiCardDashboardRouter };
