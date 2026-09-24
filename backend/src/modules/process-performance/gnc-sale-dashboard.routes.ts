import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getGncSaleDashboard, getGncAgentDetail, getGncCampaignDetail } from "./gnc-sale-dashboard.service.js";
import { getGncAbandonCartDashboard } from "./gnc-abandon-cart-dashboard.service.js";

const router = Router();
const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);

router.use(requireAuth);

/**
 * Same viewer role set the Bellavita sale dashboard route uses -- this
 * endpoint backs one dashboard on the same Process Performance V2 page.
 */
const VIEWER_ROLES = [
  "admin", "ceo", "coo", "manager", "process_manager", "operations_manager",
  "branch_head", "qa", "quality_analyst", "tq_head",
];

router.get("/gnc-sale-dashboard", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  // Defaults to the current month (1st .. today) when from/to are absent
  // or malformed -- getGncSaleDashboard applies the same fallback itself,
  // so an invalid query string can never 500 or silently scan an unbounded
  // range.
  const from = String(req.query.from ?? "");
  const to = String(req.query.to ?? "");
  const data = await getGncSaleDashboard(from, to);
  res.json({ success: true, data });
}));

router.get("/gnc-sale-dashboard/agent-detail", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const empId = String(req.query.empId ?? "").trim();
  if (!empId) return res.status(400).json({ success: false, error: "empId is required" });
  const data = await getGncAgentDetail(empId, String(req.query.from ?? ""), String(req.query.to ?? ""));
  if (!data) return res.status(404).json({ success: false, error: "No records for this agent in the chosen date range" });
  res.json({ success: true, data });
}));

router.get("/gnc-sale-dashboard/campaign-detail", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const campaign = String(req.query.campaign ?? "").trim();
  if (!campaign) return res.status(400).json({ success: false, error: "campaign is required" });
  const data = await getGncCampaignDetail(campaign, String(req.query.from ?? ""), String(req.query.to ?? ""));
  if (!data) return res.status(404).json({ success: false, error: "No records for this LOB in the chosen date range" });
  res.json({ success: true, data });
}));

router.get("/gnc-abandon-cart-dashboard", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const from = String(req.query.from ?? "");
  const to = String(req.query.to ?? "");
  const data = await getGncAbandonCartDashboard(from, to);
  res.json({ success: true, data });
}));

export { router as gncSaleDashboardRouter };
