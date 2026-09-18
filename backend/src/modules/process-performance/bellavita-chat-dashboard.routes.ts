import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getBellavitaChatDashboard, getBellavitaChatLobSnapshot } from "./bellavita-chat-dashboard.service.js";

const router = Router();
const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);

router.use(requireAuth);

const VIEWER_ROLES = [
  "admin", "ceo", "coo", "manager", "process_manager", "operations_manager",
  "branch_head", "qa", "quality_analyst", "tq_head",
];

router.get("/bellavita-chat-dashboard", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const from = String(req.query.from ?? "");
  const to = String(req.query.to ?? "");
  const lob = req.query.lob ? String(req.query.lob) : undefined;
  const data = await getBellavitaChatDashboard(from, to, lob);
  res.json({ success: true, data });
}));

router.get("/bellavita-chat-dashboard/lob-snapshot", requireRole(...VIEWER_ROLES), h(async (_req, res) => {
  const data = await getBellavitaChatLobSnapshot();
  res.json({ success: true, data });
}));

export { router as bellavitaChatDashboardRouter };
