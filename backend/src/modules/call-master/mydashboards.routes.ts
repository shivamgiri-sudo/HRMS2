import { Router, type Request, type Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getIstDateString } from "../../utils/dateUtils.js";
import { narrowClientIds, scopeClientIdsMiddleware } from "./call-master.scope.js";
import { getClientList } from "./call-master.service.js";
import { querySource } from "../../db/sourceDb.js";
import * as svc from "./upstream/call-master.service.js";
import * as oi from "./upstream/opening-intelligence.service.js";
import * as ci from "./upstream/customer-intelligence.service.js";

/*
 * Serves the dashboards synced from tausifansari-mcn/Mydashboards (src/features/call-master-sync) at
 * /api/mydashboards/call-master/*. The SQL lives in ./upstream (overwritten by scripts/sync-mydashboards.mjs);
 * this file is the HRMS-owned seam: HRMS auth, role gate and branch scoping in front, upstream's own
 * request/response contract behind. scripts/sync-mydashboards.mjs fails when upstream adds a route missing here.
 */
export const myDashboardsRouter = Router();

myDashboardsRouter.use(
  requireAuth,
  requireRole("super_admin", "admin", "ceo", "coo", "tq_head", "manager", "process_manager", "operations_manager", "qa", "quality_analyst"),
  scopeClientIdsMiddleware,
);

type Lob = "Inbound" | "Outbound" | "All";
type Period = "daily" | "weekly" | "monthly";
type LongPeriod = Period | "quarterly" | "yearly";
type Dim = "client" | "agent" | "campaign";

const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const num = (v: unknown) => Number(v) || 0;

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Upstream's filter contract, scoped. `lob` forces a line of business for the outbound-only dashboards. */
function filtersOf(req: Request, res: Response, lob?: Lob): svc.CallMasterFilters {
  const now = new Date();
  const startDate = str(req.query.startDate) || `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01 00:00`;
  const endDate = str(req.query.endDate) || `${getIstDateString()} 23:59`;
  const raw = str(req.query.clientId) ?? str(req.query.clientIds);
  const requested = raw ? raw.split(",").map(Number).filter((n) => !Number.isNaN(n)) : undefined;
  const allowed = res.locals.allowedClientIds as number[] | null | undefined;
  const clientIds = allowed ? narrowClientIds(requested, allowed) : requested?.length ? requested : undefined;
  const requestedLob = str(req.query.lob);
  return { startDate, endDate, clientIds, lob: lob ?? (["Inbound", "Outbound", "All"].includes(requestedLob ?? "") ? (requestedLob as Lob) : "All") };
}

const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: (e?: unknown) => void) =>
    fn(req, res).then((data) => (data === undefined ? undefined : res.json({ success: true, data }))).catch(next);

const bad = (res: Response, message: string) => {
  res.status(400).json({ success: false, message });
  return undefined;
};

// ── Core call master ───────────────────────────────────────────────────────
myDashboardsRouter.get("/kpis", wrap((q, s) => svc.getKPIs(filtersOf(q, s))));
myDashboardsRouter.get("/quality-trend", wrap((q, s) => svc.getQualityTrend(filtersOf(q, s), (str(q.query.period) as Period) || "daily")));
myDashboardsRouter.get("/calls-by-client", wrap((q, s) => svc.getCallsByClient(filtersOf(q, s))));
myDashboardsRouter.get("/calls-by-hour", wrap((q, s) => svc.getCallsByHour(filtersOf(q, s))));
myDashboardsRouter.get("/calls-by-day", wrap((q, s) => svc.getCallsByDay(filtersOf(q, s))));
myDashboardsRouter.get("/calls-by-month", wrap((q, s) => svc.getCallsByMonth(filtersOf(q, s))));
myDashboardsRouter.get("/top-agents", wrap((q, s) => svc.getTopAgents(filtersOf(q, s), Math.min(num(q.query.limit) || 10, 50))));
myDashboardsRouter.get("/sales-funnel", wrap((q, s) => svc.getSalesFunnel(filtersOf(q, s))));
myDashboardsRouter.get("/cx-parameters", wrap((q, s) => svc.getCXParameters(filtersOf(q, s))));
myDashboardsRouter.get("/agent-params", wrap(async (q, s) => {
  const agent = str(q.query.agent);
  return agent ? svc.getAgentParams(agent, filtersOf(q, s)) : bad(s, "agent query param required");
}));
myDashboardsRouter.get("/scenario-detail", wrap(async (q, s) => {
  const scenario = str(q.query.scenario);
  return scenario ? svc.getScenarioDetail(scenario, filtersOf(q, s)) : bad(s, "scenario query param required");
}));
myDashboardsRouter.get("/active-agents-list", wrap((q, s) => svc.getActiveAgentsList(filtersOf(q, s))));
myDashboardsRouter.get("/clients", wrap(async (_q, s) => {
  const allowed = s.locals.allowedClientIds as number[] | null | undefined;
  const clients = await getClientList();
  return clients
    .filter((c) => !allowed || allowed.includes(Number(c.id)))
    .map((c) => ({ id: c.id, name: c.name, dialdesk_client_id: c.id }));
}));
// Upstream reads md_processes, which this host does not have; the client master stands in as the "process" list.
myDashboardsRouter.get("/process-list", wrap(async (q, s) => {
  const { startDate, endDate, clientIds } = filtersOf(q, s);
  const filter = clientIds?.length ? ` AND c.client_id IN (${clientIds.map(() => "?").join(",")})` : "";
  const rows = await querySource<{ name: string; total: number; quality: number | null; fatal: number }>(
    `SELECT c.display_name AS name, COUNT(q.CallDate) AS total, ROUND(AVG(q.quality_percentage), 1) AS quality,
            COALESCE(SUM(q.quality_percentage = 0), 0) AS fatal
     FROM Shivamgiri.portal_client_config c
     LEFT JOIN db_audit.call_quality_assessment q
       ON CAST(q.ClientId AS UNSIGNED) = c.client_id AND q.CallDate BETWEEN ? AND ?
     WHERE c.is_active = 1 AND c.display_name IS NOT NULL AND c.display_name != ''${filter}
     GROUP BY c.client_id, c.display_name ORDER BY c.display_name`,
    [startDate, endDate, ...(clientIds ?? [])],
  );
  return rows.map((r) => ({
    process_name: r.name, lob: "Inbound", client_name: r.name,
    total_calls: num(r.total), quality_score: r.quality === null ? null : Number(r.quality),
    fatal_calls: num(r.fatal), fatal_rate: num(r.total) ? Math.round((num(r.fatal) / num(r.total)) * 1000) / 10 : null,
  }));
}));
myDashboardsRouter.get("/fatal-by-day", wrap((q, s) => svc.getFatalByDay(filtersOf(q, s))));
myDashboardsRouter.get("/export", wrap(async (q, s) => {
  const source = str(q.query.source) === "outbound" ? "outbound" : "inbound";
  const columns = str(q.query.columns)?.split(",").map((c) => c.trim()).filter(Boolean) ?? [];
  const rows = await svc.getExportData(filtersOf(q, s, "All"), source, columns, Math.min(num(q.query.limit) || 5000, 10000));
  return { rows, count: rows.length };
}));
myDashboardsRouter.get("/fatal-agent-summary", wrap(async (q, s) => {
  const rows = await svc.getFatalAgentSummary(filtersOf(q, s, "Inbound"), Math.min(num(q.query.limit) || 50000, 100000));
  return { rows, count: rows.length };
}));
myDashboardsRouter.get("/agent-audit-summary", wrap((q, s) => svc.getAgentAuditSummary(filtersOf(q, s))));

// ── Outbound sales ─────────────────────────────────────────────────────────
myDashboardsRouter.get("/outbound/summary", wrap((q, s) => svc.getOBSummary(filtersOf(q, s))));
myDashboardsRouter.get("/outbound/daily-trend", wrap((q, s) => svc.getOBDailyTrend(filtersOf(q, s))));
myDashboardsRouter.get("/outbound/hourly", wrap((q, s) => svc.getOBHourly(filtersOf(q, s))));
myDashboardsRouter.get("/outbound/agents", wrap((q, s) => svc.getOBAgentPerf(filtersOf(q, s), Math.min(num(q.query.limit) || 100, 500))));
myDashboardsRouter.get("/outbound/agent-daily", wrap(async (q, s) => {
  const agentName = str(q.query.agentName);
  return agentName ? svc.getOBAgentDaily(agentName, filtersOf(q, s)) : bad(s, "agentName required");
}));
myDashboardsRouter.get("/outbound/disposition", wrap((q, s) => svc.getOBDisposition(filtersOf(q, s))));
myDashboardsRouter.get("/outbound/products", wrap((q, s) => svc.getOBProductMix(filtersOf(q, s))));
myDashboardsRouter.get("/outbound/not-interested", wrap((q, s) => svc.getOBNotInterested(filtersOf(q, s))));
myDashboardsRouter.get("/outbound/quality-params", wrap((q, s) => svc.getOBQualityParams(filtersOf(q, s))));

// ── Opening intelligence (outbound only) ───────────────────────────────────
const oiF = (q: Request, s: Response) => filtersOf(q, s, "Outbound");
const longPeriod = (q: Request) => (str(q.query.period) as LongPeriod) || "daily";
const dimOf = (q: Request) => (str(q.query.dim) as Dim) || "agent";
myDashboardsRouter.get("/opening-intelligence/executive-summary", wrap((q, s) => oi.getOIExecutiveSummary(oiF(q, s))));
myDashboardsRouter.get("/opening-intelligence/opening-categories", wrap((q, s) => oi.getOpeningByCategory(oiF(q, s))));
myDashboardsRouter.get("/opening-intelligence/opening-raw", wrap((q, s) => oi.getOpeningRawCategories(oiF(q, s))));
myDashboardsRouter.get("/opening-intelligence/opening-trend", wrap((q, s) => oi.getOpeningTrend(oiF(q, s), longPeriod(q))));
myDashboardsRouter.get("/opening-intelligence/opening-by-dim", wrap((q, s) => oi.getOpeningByDimension(oiF(q, s), dimOf(q))));
myDashboardsRouter.get("/opening-intelligence/context-categories", wrap((q, s) => oi.getContextByCategory(oiF(q, s))));
myDashboardsRouter.get("/opening-intelligence/context-trend", wrap((q, s) => oi.getContextTrend(oiF(q, s), longPeriod(q))));
myDashboardsRouter.get("/opening-intelligence/context-by-dim", wrap((q, s) => oi.getContextByDimension(oiF(q, s), dimOf(q))));
myDashboardsRouter.get("/opening-intelligence/opening-vs-sales", wrap((q, s) => oi.getOpeningVsSales(oiF(q, s))));
myDashboardsRouter.get("/opening-intelligence/leaderboard", wrap((q, s) => oi.getOpeningLeaderboard(oiF(q, s))));
myDashboardsRouter.get("/opening-intelligence/ai-insights", wrap((q, s) => oi.getOIAIInsights(oiF(q, s))));

// ── Customer intelligence (outbound only) ──────────────────────────────────
myDashboardsRouter.get("/customer-intelligence/executive-summary", wrap((q, s) => ci.getCIExecutiveSummary(oiF(q, s))));
myDashboardsRouter.get("/customer-intelligence/sentiment", wrap((q, s) => ci.getSentimentDistribution(oiF(q, s))));
myDashboardsRouter.get("/customer-intelligence/sentiment-trend", wrap((q, s) => ci.getSentimentTrend(oiF(q, s), longPeriod(q))));
myDashboardsRouter.get("/customer-intelligence/feedback-categories", wrap((q, s) => ci.getFeedbackCategories(oiF(q, s))));
myDashboardsRouter.get("/customer-intelligence/feedback-subcats", wrap((q, s) => ci.getFeedbackSubCategories(oiF(q, s))));
myDashboardsRouter.get("/customer-intelligence/top-objections", wrap((q, s) => ci.getTopObjections(oiF(q, s))));
myDashboardsRouter.get("/customer-intelligence/journey", wrap((q, s) => ci.getCustomerJourney(oiF(q, s))));
myDashboardsRouter.get("/customer-intelligence/feedback-by-dim", wrap((q, s) => ci.getFeedbackByDimension(oiF(q, s), dimOf(q))));
myDashboardsRouter.get("/customer-intelligence/client-comparison", wrap((q, s) => ci.getClientComparison(oiF(q, s))));
myDashboardsRouter.get("/customer-intelligence/campaign-comparison", wrap((q, s) => ci.getCampaignComparison(oiF(q, s))));
myDashboardsRouter.get("/customer-intelligence/agent-ranking", wrap((q, s) => ci.getAgentCXRanking(oiF(q, s))));
myDashboardsRouter.get("/customer-intelligence/agent-nps-csat", wrap((q, s) => ci.getAgentNPSCSAT(oiF(q, s))));
myDashboardsRouter.get("/customer-intelligence/product-feedback", wrap((q, s) => ci.getProductFeedback(oiF(q, s))));
myDashboardsRouter.get("/customer-intelligence/offering-funnel", wrap((q, s) => ci.getOfferingFunnel(oiF(q, s))));
myDashboardsRouter.get("/customer-intelligence/ai-insights", wrap((q, s) => ci.getCIAIInsights(oiF(q, s))));
