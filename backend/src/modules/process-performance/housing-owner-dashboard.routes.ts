import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getHousingOwnerDashboard, getHousingOwnerEntityTrend, getHousingOwnerOutbound } from "./housing-owner-dashboard.service.js";
import { mountProcessTargetRoutes } from "./process-targets.routes.js";

const router = Router();
const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);

router.use(requireAuth);

const VIEWER_ROLES = [
  "admin", "ceo", "coo", "manager", "process_manager", "operations_manager",
  "branch_head", "qa", "quality_analyst", "tq_head",
];

router.get("/housing-owner-dashboard", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const from = String(req.query.from ?? "");
  const to = String(req.query.to ?? "");
  const tl = String(req.query.tl ?? "");
  const am = String(req.query.am ?? "");
  const data = await getHousingOwnerDashboard(from, to, tl, am);
  res.json({ success: true, data });
}));

router.get("/housing-owner-dashboard/entity-trend", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const type = String(req.query.type ?? "");
  const name = String(req.query.name ?? "");
  if (type !== "am" && type !== "tl" && type !== "agent") {
    res.status(400).json({ success: false, message: "type must be am, tl or agent" });
    return;
  }
  if (!name.trim()) {
    res.status(400).json({ success: false, message: "name is required" });
    return;
  }
  const from = String(req.query.from ?? "");
  const to = String(req.query.to ?? "");
  const data = await getHousingOwnerEntityTrend(from, to, type, name);
  res.json({ success: true, data });
}));

router.get("/housing-owner-dashboard/outbound", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await getHousingOwnerOutbound(String(req.query.from ?? ""), String(req.query.to ?? ""));
  res.json({ success: true, data });
}));

mountProcessTargetRoutes(router, { base: "/housing-owner-targets", process: "housing_owner", wrap: h as never });

export { router as housingOwnerDashboardRouter };
