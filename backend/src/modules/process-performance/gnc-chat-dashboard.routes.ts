import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getGncChatDashboard } from "./gnc-chat-dashboard.service.js";
import { resolveGncTargets, decorateChatWithTargets } from "./gnc-targets.service.js";

const router = Router();
const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);

router.use(requireAuth);

const VIEWER_ROLES = [
  "admin", "ceo", "coo", "manager", "process_manager", "operations_manager",
  "branch_head", "qa", "quality_analyst", "tq_head",
];

router.get("/gnc-chat-dashboard", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const from = String(req.query.from ?? "");
  const to = String(req.query.to ?? "");
  const data = await getGncChatDashboard(from, to);
  const targets = await resolveGncTargets(data.from, data.to);
  res.json({ success: true, data: decorateChatWithTargets(data, targets) });
}));

export { router as gncChatDashboardRouter };
