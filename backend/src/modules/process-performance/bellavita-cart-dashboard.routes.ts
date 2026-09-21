import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getBellavitaCartDashboard } from "./bellavita-cart-dashboard.service.js";
import { getBellavitaCartSnapshot, getBellavitaCartAgents, getBellavitaCartAgentDetail } from "./bellavita-cart-snapshot.service.js";

const router = Router();
const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);

router.use(requireAuth);

const VIEWER_ROLES = [
  "admin", "ceo", "coo", "manager", "process_manager", "operations_manager",
  "branch_head", "qa", "quality_analyst", "tq_head",
];

router.get("/bellavita-cart-dashboard", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const from = String(req.query.from ?? "");
  const to = String(req.query.to ?? "");
  const data = await getBellavitaCartDashboard(from, to);
  res.json({ success: true, data });
}));

router.get("/bellavita-cart-dashboard/snapshot", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await getBellavitaCartSnapshot(String(req.query.from ?? ""), String(req.query.to ?? ""));
  res.json({ success: true, data });
}));

router.get("/bellavita-cart-dashboard/agents", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await getBellavitaCartAgents(String(req.query.from ?? ""), String(req.query.to ?? ""));
  res.json({ success: true, data });
}));

router.get("/bellavita-cart-dashboard/agent-detail", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const empId = String(req.query.empId ?? "").trim();
  if (!/^MAS\d+$/i.test(empId)) return res.status(400).json({ success: false, error: "empId must look like MAS12345" });
  const data = await getBellavitaCartAgentDetail(empId, String(req.query.from ?? ""), String(req.query.to ?? ""));
  if (!data) return res.status(404).json({ success: false, error: "No records for this agent in the chosen date range" });
  res.json({ success: true, data });
}));

export { router as bellavitaCartDashboardRouter };
