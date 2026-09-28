import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import {
  getAppreciateWealthDashboard, getAgentDetail, getAgentDayDetail, getBillingTypeDetail, getCallDetail, getDayDetail,
  getGroupDetail, getMandateDetail, getSourceDetail, parseFilters,
} from "./appreciate-wealth-dashboard.service.js";
import { getAwControlCenter } from "./appreciate-wealth-control-center.service.js";
import { getAwInboundCenter } from "./appreciate-wealth-inbound-center.service.js";
import { getAwOutboundCenter } from "./appreciate-wealth-outbound-center.service.js";
import { getAwCdrCenter } from "./appreciate-wealth-cdr-center.service.js";

/**
 * Appreciate Wealth dashboards -- read-only (GET only, no writes, no state
 * changes to audit). Mounted under /api/process-performance/appreciate-wealth.
 */
const router = Router();
const h = (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);

router.use(requireAuth);

const VIEWER_ROLES = [
  "admin", "ceo", "coo", "manager", "process_manager", "operations_manager",
  "branch_head", "qa", "quality_analyst", "tq_head",
];
const BASE = "/appreciate-wealth";
const q = (req: AuthenticatedRequest, k: string): string => String(req.query[k] ?? "");
const notFound = (res: Response) => res.status(404).json({ success: false, error: "Record not found." });

router.get(`${BASE}/dashboard`, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await getAppreciateWealthDashboard(q(req, "from"), q(req, "to"), parseFilters(req.query));
  res.json({ success: true, data });
}));

router.get(`${BASE}/inbound-center`, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await getAwInboundCenter(q(req, "from"), q(req, "to"));
  res.json({ success: true, data });
}));

router.get(`${BASE}/cdr-center`, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await getAwCdrCenter(q(req, "from"), q(req, "to"));
  res.json({ success: true, data });
}));

router.get(`${BASE}/outbound-center`, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await getAwOutboundCenter(q(req, "from"), q(req, "to"));
  res.json({ success: true, data });
}));

router.get(`${BASE}/control-center`, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await getAwControlCenter(q(req, "from"), q(req, "to"), q(req, "segment"));
  res.json({ success: true, data });
}));

router.get(`${BASE}/agent/:agentId`, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await getAgentDetail(String(req.params.agentId), q(req, "from"), q(req, "to"));
  return data ? res.json({ success: true, data }) : notFound(res);
}));

router.get(`${BASE}/source/:table`, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await getSourceDetail(String(req.params.table));
  return data ? res.json({ success: true, data }) : notFound(res);
}));

router.get(`${BASE}/day/:date`, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await getDayDetail(String(req.params.date), q(req, "to"));
  return data ? res.json({ success: true, data }) : notFound(res);
}));

router.get(`${BASE}/billing-type/:type`, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await getBillingTypeDetail(String(req.params.type), q(req, "from"), q(req, "to"));
  return data ? res.json({ success: true, data }) : notFound(res);
}));

router.get(`${BASE}/group/:source/:dim`, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await getGroupDetail(String(req.params.source), String(req.params.dim), q(req, "value"), q(req, "from"), q(req, "to"));
  return data ? res.json({ success: true, data }) : notFound(res);
}));

router.get(`${BASE}/call/:source/:id`, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await getCallDetail(String(req.params.source), Number(req.params.id));
  return data ? res.json({ success: true, data }) : notFound(res);
}));

router.get(`${BASE}/agent-day/:source/:id`, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await getAgentDayDetail(String(req.params.source), Number(req.params.id));
  return data ? res.json({ success: true, data }) : notFound(res);
}));

router.get(`${BASE}/mandate/:id`, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await getMandateDetail(Number(req.params.id));
  return data ? res.json({ success: true, data }) : notFound(res);
}));

export { router as appreciateWealthDashboardRouter };
