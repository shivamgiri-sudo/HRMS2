import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getDuDigitalDashboard, type DuDashboardLabel } from "./du-digital-dashboard.service.js";

const router = Router();
const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);

router.use(requireAuth);

const VIEWER_ROLES = [
  "admin", "super_admin", "ceo", "coo", "manager", "process_manager", "operations_manager",
  "branch_head", "qa", "quality_analyst", "tq_head",
];

function resolveLabel(country: string): DuDashboardLabel | null {
  const c = country.toUpperCase();
  return c === "KOREA" || c === "THAILAND" ? c : null;
}

router.get("/du-digital/:country/dashboard", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const label = resolveLabel(String(req.params.country ?? ""));
  if (!label) return res.status(400).json({ success: false, message: "country must be 'korea' or 'thailand'" });
  const data = await getDuDigitalDashboard(label, String(req.query.from ?? ""), String(req.query.to ?? ""));
  res.json({ success: true, data });
}));

export const duDigitalDashboardRouter = router;
