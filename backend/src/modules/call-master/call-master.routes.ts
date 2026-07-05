import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import * as svc from "./call-master.service.js";
import * as obSvc from "./outbound-sales.service.js";
import * as oiSvc from "./opening-intelligence.service.js";
import * as ciSvc from "./customer-intelligence.service.js";

const router = Router();
const h = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: (e?: unknown) => void) => fn(req, res).catch(next);

router.use(
  requireAuth,
  requireRole("super_admin", "admin", "ceo", "manager", "process_manager", "operations_manager", "qa", "quality_analyst")
);

// ── Helpers ────────────────────────────────────────────────────────────────
function parseFilters(q: Record<string, unknown>): svc.CallMasterFilters {
  const now = new Date();
  const endDate   = q.endDate   ? String(q.endDate)   : now.toISOString().slice(0, 10);
  const startDate = q.startDate ? String(q.startDate) : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const clientIds = q.clientIds
    ? String(q.clientIds).split(",").map(Number).filter((n) => !isNaN(n))
    : undefined;
  const lob = (q.lob as "Inbound" | "Outbound" | "All") || "All";
  return { startDate, endDate, clientIds, lob };
}

// ── Core call-master routes ────────────────────────────────────────────────
router.get("/kpis",               h(async (req, res) => res.json({ data: await svc.getKPIs(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/quality-trend",      h(async (req, res) => {
  const f = parseFilters(req.query as Record<string, unknown>);
  const granularity = (req.query.granularity as "daily" | "weekly" | "monthly") || "daily";
  res.json({ data: await svc.getQualityTrend(f, granularity) });
}));
router.get("/calls-by-client",    h(async (req, res) => res.json({ data: await svc.getCallsByClient(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/calls-by-day",       h(async (req, res) => res.json({ data: await svc.getCallsByDay(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/top-agents",         h(async (req, res) => {
  const f = parseFilters(req.query as Record<string, unknown>);
  const limit = parseInt(String(req.query.limit ?? "10"), 10);
  const order = (req.query.order as "top" | "bottom") || "top";
  res.json({ data: await svc.getTopAgents(f, limit, order) });
}));
router.get("/agent-audit-summary",h(async (req, res) => res.json({ data: await svc.getAgentAuditSummary(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/sales-funnel",       h(async (req, res) => res.json({ data: await svc.getSalesFunnel(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/cx-parameters",      h(async (req, res) => res.json({ data: await svc.getCXParameters(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/fatal-by-day",       h(async (req, res) => res.json({ data: await svc.getFatalByDay(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/fatal-agent-summary",h(async (req, res) => {
  const limit = parseInt(String(req.query.limit ?? "500"), 10);
  res.json({ data: await svc.getFatalAgentSummary(parseFilters(req.query as Record<string, unknown>), limit) });
}));
router.get("/scenario-detail",    h(async (req, res) => res.json({ data: await svc.getScenarioDetail(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/active-agents-list", h(async (req, res) => res.json({ data: await svc.getActiveAgentsList(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/clients",            h(async (_req, res) => res.json({ data: await svc.getClientList() })));
router.get("/export",             h(async (req, res) => {
  const limit = parseInt(String(req.query.limit ?? "5000"), 10);
  res.json({ data: await svc.getExportData(parseFilters(req.query as Record<string, unknown>), limit) });
}));

// ── Outbound sales sub-routes ──────────────────────────────────────────────
router.get("/outbound/summary",       h(async (req, res) => res.json({ data: await obSvc.getOBSummary(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/outbound/daily-trend",   h(async (req, res) => res.json({ data: await obSvc.getOBDailyTrend(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/outbound/hourly",        h(async (req, res) => res.json({ data: await obSvc.getOBHourly(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/outbound/agents",        h(async (req, res) => res.json({ data: await obSvc.getOBAgentPerf(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/outbound/agent-daily",   h(async (req, res) => res.json({ data: await obSvc.getOBAgentDaily(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/outbound/disposition",   h(async (req, res) => res.json({ data: await obSvc.getOBDisposition(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/outbound/products",      h(async (req, res) => res.json({ data: await obSvc.getOBProductMix(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/outbound/not-interested",h(async (req, res) => res.json({ data: await obSvc.getOBNotInterested(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/outbound/quality-params",h(async (req, res) => res.json({ data: await obSvc.getOBQualityParams(parseFilters(req.query as Record<string, unknown>)) })));

// ── Opening Intelligence sub-routes ───────────────────────────────────────
router.get("/opening-intelligence/executive-summary",  h(async (req, res) => res.json({ data: await oiSvc.getOIExecutiveSummary(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/opening-intelligence/opening-categories", h(async (req, res) => res.json({ data: await oiSvc.getOpeningByCategory(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/opening-intelligence/opening-raw",        h(async (req, res) => res.json({ data: await oiSvc.getOpeningRawCategories(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/opening-intelligence/opening-trend",      h(async (req, res) => {
  const p = (req.query.period as "daily" | "weekly" | "monthly" | "quarterly" | "yearly") || "daily";
  res.json({ data: await oiSvc.getOpeningTrend(parseFilters(req.query as Record<string, unknown>), p) });
}));
router.get("/opening-intelligence/opening-by-dim",     h(async (req, res) => {
  const dim = (req.query.dim as "client_id" | "AgentName" | "campaign_id") || "client_id";
  res.json({ data: await oiSvc.getOpeningByDimension(parseFilters(req.query as Record<string, unknown>), dim) });
}));
router.get("/opening-intelligence/context-categories", h(async (req, res) => res.json({ data: await oiSvc.getContextByCategory(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/opening-intelligence/context-trend",      h(async (req, res) => {
  const p = (req.query.period as "daily" | "weekly" | "monthly" | "quarterly" | "yearly") || "daily";
  res.json({ data: await oiSvc.getContextTrend(parseFilters(req.query as Record<string, unknown>), p) });
}));
router.get("/opening-intelligence/context-by-dim",     h(async (req, res) => {
  const dim = (req.query.dim as "client_id" | "AgentName" | "campaign_id") || "client_id";
  res.json({ data: await oiSvc.getContextByDimension(parseFilters(req.query as Record<string, unknown>), dim) });
}));
router.get("/opening-intelligence/opening-vs-sales",   h(async (req, res) => res.json({ data: await oiSvc.getOpeningVsSales(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/opening-intelligence/leaderboard",        h(async (req, res) => res.json({ data: await oiSvc.getOpeningLeaderboard(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/opening-intelligence/ai-insights",        h(async (req, res) => res.json({ data: await oiSvc.getOIAIInsights(parseFilters(req.query as Record<string, unknown>)) })));

// ── Customer Intelligence sub-routes ──────────────────────────────────────
router.get("/customer-intelligence/executive-summary",  h(async (req, res) => res.json({ data: await ciSvc.getCIExecutiveSummary(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/customer-intelligence/sentiment",          h(async (req, res) => res.json({ data: await ciSvc.getSentimentDistribution(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/customer-intelligence/sentiment-trend",    h(async (req, res) => {
  const p = (req.query.period as "daily" | "weekly" | "monthly" | "quarterly" | "yearly") || "daily";
  res.json({ data: await ciSvc.getSentimentTrend(parseFilters(req.query as Record<string, unknown>), p) });
}));
router.get("/customer-intelligence/feedback-categories",h(async (req, res) => res.json({ data: await ciSvc.getFeedbackCategories(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/customer-intelligence/feedback-subcats",   h(async (req, res) => res.json({ data: await ciSvc.getFeedbackSubCategories(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/customer-intelligence/top-objections",     h(async (req, res) => res.json({ data: await ciSvc.getTopObjections(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/customer-intelligence/journey",            h(async (req, res) => res.json({ data: await ciSvc.getCustomerJourney(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/customer-intelligence/client-comparison",  h(async (req, res) => res.json({ data: await ciSvc.getClientComparison(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/customer-intelligence/campaign-comparison",h(async (req, res) => res.json({ data: await ciSvc.getCampaignComparison(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/customer-intelligence/agent-ranking",      h(async (req, res) => res.json({ data: await ciSvc.getAgentCXRanking(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/customer-intelligence/agent-nps-csat",     h(async (req, res) => res.json({ data: await ciSvc.getAgentNPSCSAT(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/customer-intelligence/product-feedback",   h(async (req, res) => res.json({ data: await ciSvc.getProductFeedback(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/customer-intelligence/offering-funnel",    h(async (req, res) => res.json({ data: await ciSvc.getOfferingFunnel(parseFilters(req.query as Record<string, unknown>)) })));
router.get("/customer-intelligence/ai-insights",        h(async (req, res) => res.json({ data: await ciSvc.getCIAIInsights(parseFilters(req.query as Record<string, unknown>)) })));

export { router as callMasterRouter };
