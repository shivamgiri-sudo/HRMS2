import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import {
  getHousingPremiumOverview, getHousingPremiumDayWise, getHousingPremiumAgentWise,
  getHousingPremiumSlotWise, getHousingPremiumTqMqBqAgents, getHousingPremiumTqMqBqTl,
  getHousingPremiumTeamDetails, getHousingPremiumValidation, getHousingPremiumAgentDetail,
} from "./housing-premium-dashboard.service.js";
import { mountProcessTargetRoutes } from "./process-targets.routes.js";

const router = Router();
const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);

router.use(requireAuth);

const VIEWER_ROLES = [
  "admin", "super_admin", "ceo", "coo", "manager", "process_manager", "operations_manager",
  "branch_head", "qa", "quality_analyst", "tq_head",
];

router.get("/housing-premium-dashboard/overview", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await getHousingPremiumOverview(
    String(req.query.from ?? ""), String(req.query.to ?? ""), req.query.agent ? String(req.query.agent) : undefined,
  );
  res.json({ success: true, data });
}));

router.get("/housing-premium-dashboard/day-wise", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await getHousingPremiumDayWise(
    String(req.query.from ?? ""), String(req.query.to ?? ""), req.query.agent ? String(req.query.agent) : undefined,
  );
  res.json({ success: true, data });
}));

router.get("/housing-premium-dashboard/agent-wise", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await getHousingPremiumAgentWise(String(req.query.from ?? ""), String(req.query.to ?? ""));
  res.json({ success: true, data });
}));

router.get("/housing-premium-dashboard/slot-wise", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await getHousingPremiumSlotWise(
    String(req.query.from ?? ""), String(req.query.to ?? ""), req.query.agent ? String(req.query.agent) : undefined,
  );
  res.json({ success: true, data });
}));

router.get("/housing-premium-dashboard/tq-mq-bq/agents", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await getHousingPremiumTqMqBqAgents(String(req.query.month ?? ""));
  res.json({ success: true, data });
}));

router.get("/housing-premium-dashboard/tq-mq-bq/tl", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await getHousingPremiumTqMqBqTl(String(req.query.month ?? ""));
  res.json({ success: true, data });
}));

router.get("/housing-premium-dashboard/team-details", requireRole(...VIEWER_ROLES), h(async (_req, res) => {
  const data = await getHousingPremiumTeamDetails();
  res.json({ success: true, data });
}));

router.get("/housing-premium-dashboard/validation", requireRole(...VIEWER_ROLES), h(async (_req, res) => {
  const data = await getHousingPremiumValidation();
  res.json({ success: true, data });
}));

router.get("/housing-premium-dashboard/agent-detail", requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const agent = String(req.query.agent ?? "").trim();
  if (!agent) return res.status(400).json({ success: false, error: "agent is required" });
  const data = await getHousingPremiumAgentDetail(agent, String(req.query.from ?? ""), String(req.query.to ?? ""));
  if (!data) return res.status(404).json({ success: false, error: "No records for this agent in the chosen date range" });
  res.json({ success: true, data });
}));

mountProcessTargetRoutes(router, { base: "/housing-premium-targets", process: "housing_premium", wrap: h as never });

export { router as housingPremiumDashboardRouter };
