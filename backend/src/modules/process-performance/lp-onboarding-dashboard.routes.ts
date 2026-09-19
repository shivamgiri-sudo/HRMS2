import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getLpOnboardingDashboard, getLpOnboardingDetail } from "./lp-onboarding-dashboard.service.js";
import { LP_DETAIL_KINDS, type LpDetailKind } from "./lp-call-dashboard.shared.js";

const router = Router();
const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);

router.use(requireAuth);

const VIEWER_ROLES = [
  "admin", "ceo", "coo", "manager", "process_manager", "operations_manager",
  "branch_head", "qa", "quality_analyst", "tq_head",
];

router.get("/lp-onboarding-dashboard", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const from = String(req.query.from ?? "");
  const to = String(req.query.to ?? "");
  const data = await getLpOnboardingDashboard(from, to);
  res.json({ success: true, data });
}));

router.get("/lp-onboarding-dashboard/detail", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const kind = String(req.query.kind ?? "") as LpDetailKind;
  const key = String(req.query.key ?? "").trim();
  if (!LP_DETAIL_KINDS.includes(kind) || !key) {
    return res.status(400).json({ success: false, error: "kind (agent|service|week|day) and key are required" });
  }
  const data = await getLpOnboardingDetail(kind, key, String(req.query.from ?? ""), String(req.query.to ?? ""));
  if (!data) return res.status(404).json({ success: false, error: "No records for this selection in the chosen date range" });
  res.json({ success: true, data });
}));

export { router as lpOnboardingDashboardRouter };
