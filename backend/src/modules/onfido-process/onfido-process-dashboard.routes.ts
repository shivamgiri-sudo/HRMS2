import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import * as svc from "./onfido-process-dashboard.service.js";

const router = Router();
type AsyncHandler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const h = (fn: AsyncHandler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};

/** Who may open the Onfido process dashboard. super_admin short-circuits requireRole. */
const VIEWER_ROLES = [
  "admin", "ceo", "coo", "manager", "process_manager", "team_leader",
  "branch_head", "qa", "quality_analyst", "wfm",
] as const;

function readQueryFilters(req: AuthenticatedRequest) {
  const q = req.query as Record<string, string | undefined>;
  return { from: q.from, to: q.to, tlName: q.tlName, amName: q.amName };
}

function readGranularity(req: AuthenticatedRequest): "daily" | "weekly" | "monthly" {
  const g = (req.query as Record<string, string | undefined>).granularity;
  return g === "daily" || g === "weekly" ? g : "monthly";
}

router.get("/overview", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await svc.getOverview(readQueryFilters(req));
  res.json({ success: true, data });
}));

router.get("/filter-options", requireAuth, requireRole(...VIEWER_ROLES), h(async (_req, res) => {
  const data = await svc.getFilterOptions();
  res.json({ success: true, data });
}));

router.get("/tl-breakdown", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await svc.getTlBreakdown(readQueryFilters(req));
  res.json({ success: true, data });
}));

router.get("/monthly-trend", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await svc.getMonthlyTrend(readQueryFilters(req));
  res.json({ success: true, data });
}));

router.get("/tables", requireAuth, requireRole(...VIEWER_ROLES), h(async (_req, res) => {
  res.json({ success: true, data: svc.listAvailableTables() });
}));

router.get("/volume-trend", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const granularity = (q.granularity === "daily" || q.granularity === "weekly") ? q.granularity : "monthly";
  const data = await svc.getVolumeTrend(readQueryFilters(req), granularity);
  res.json({ success: true, data });
}));

router.get("/alerts", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await svc.listAlerts(readQueryFilters(req));
  res.json({ success: true, data });
}));

router.get("/analyst-search", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const q = (req.query.q as string | undefined) ?? "";
  if (q.trim().length < 2) return res.json({ success: true, data: [] });
  const data = await svc.searchAnalysts(q.trim());
  res.json({ success: true, data });
}));

// Literal /analyst-search above must come before this param route.
router.get("/analyst-performance/:email", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await svc.getAnalystPerformance(req.params.email, readQueryFilters(req));
  if (!data) return res.status(404).json({ success: false, message: "No records for this analyst in range" });
  res.json({ success: true, data });
}));

router.get("/metrics", requireAuth, requireRole(...VIEWER_ROLES), h(async (_req, res) => {
  res.json({ success: true, data: svc.listMetrics() });
}));

// Multi-level drill-down for a single KPI card: level 2 (this route) is the same metric
// broken down by TL; level 3 is /metric-records/:metric (optionally add ?tlName= from a
// level-2 row); level 4 is the existing /records/:table/:id detail route, fed the `table`
// listMetricRecords returns.
router.get("/metric-breakdown/:metric", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await svc.getMetricTlBreakdown(req.params.metric, readQueryFilters(req));
  res.json({ success: true, data });
}));

router.get("/metric-records/:metric", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const data = await svc.listMetricRecords(req.params.metric, {
    from: q.from, to: q.to, tlName: q.tlName, search: q.search,
    limit: q.limit ? Number(q.limit) : undefined,
    cursor: q.cursor ? Number(q.cursor) : undefined,
  });
  res.json({ success: true, data });
}));

// Literal routes above are declared before the :table wildcard routes below —
// otherwise Express would try to match "overview"/"tl-breakdown"/etc as a table key.
router.get("/records/:table", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const data = await svc.listRecords(req.params.table, {
    from: q.from, to: q.to, tlName: q.tlName, amName: q.amName, search: q.search,
    filterColumn: q.filterColumn, filterValue: q.filterValue,
    limit: q.limit ? Number(q.limit) : undefined,
    cursor: q.cursor ? Number(q.cursor) : undefined,
  });
  res.json({ success: true, data });
}));

router.get("/records/:table/:id", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const record = await svc.getRecord(req.params.table, req.params.id);
  if (!record) return res.status(404).json({ success: false, message: "Record not found" });
  res.json({ success: true, data: record });
}));

const ATTRITION_DIMENSIONS = new Set(["am_name", "tl_name", "aon_bucket", "location"]);
router.get("/attrition/overview", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await svc.getAttritionOverview(readQueryFilters(req));
  res.json({ success: true, data });
}));
router.get("/attrition/monthly-detail", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await svc.getAttritionMonthlyDetail(readQueryFilters(req));
  res.json({ success: true, data });
}));
router.get("/attrition/trend", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await svc.getAttritionTrend(readQueryFilters(req), readGranularity(req));
  res.json({ success: true, data });
}));
router.get("/attrition/breakdown/:dimension", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const dim = req.params.dimension;
  if (!ATTRITION_DIMENSIONS.has(dim)) return res.status(400).json({ success: false, message: "Unknown dimension" });
  const data = await svc.getAttritionBreakdown(readQueryFilters(req), dim as Parameters<typeof svc.getAttritionBreakdown>[1]);
  res.json({ success: true, data });
}));
router.get("/attrition/exits", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await svc.listAttritionExits(readQueryFilters(req));
  res.json({ success: true, data });
}));

router.get("/etm/overview", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await svc.getEtmOverview(readQueryFilters(req));
  res.json({ success: true, data });
}));
router.get("/etm/trend", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await svc.getEtmTrend(readQueryFilters(req), readGranularity(req));
  res.json({ success: true, data });
}));
const ETM_DIMENSIONS = new Set(["tl_name", "am_name", "escalated_by_email"]);
router.get("/etm/breakdown/:queue/:dimension", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const { queue, dimension } = req.params;
  if (queue !== "doc" && queue !== "poa") return res.status(400).json({ success: false, message: "Unknown queue" });
  if (!ETM_DIMENSIONS.has(dimension)) return res.status(400).json({ success: false, message: "Unknown dimension" });
  const data = await svc.getEtmBreakdown(readQueryFilters(req), queue, dimension as Parameters<typeof svc.getEtmBreakdown>[2]);
  res.json({ success: true, data });
}));

router.get("/task-skip/overview", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await svc.getTaskSkipOverview(readQueryFilters(req));
  res.json({ success: true, data });
}));
router.get("/task-skip/trend", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await svc.getTaskSkipTrend(readQueryFilters(req), readGranularity(req));
  res.json({ success: true, data });
}));
const TASK_SKIP_DIMENSIONS = new Set(["tl_name", "am_name", "unassigned_from_email", "ims_client_name", "task_type"]);
router.get("/task-skip/breakdown/:dimension", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const dim = req.params.dimension;
  if (!TASK_SKIP_DIMENSIONS.has(dim)) return res.status(400).json({ success: false, message: "Unknown dimension" });
  const data = await svc.getTaskSkipBreakdown(readQueryFilters(req), dim as Parameters<typeof svc.getTaskSkipBreakdown>[1]);
  res.json({ success: true, data });
}));

router.get("/quality/overview", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await svc.getQualityOverview(readQueryFilters(req));
  res.json({ success: true, data });
}));
router.get("/quality/trend", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await svc.getQualityTrend(readQueryFilters(req), readGranularity(req));
  res.json({ success: true, data });
}));
const QUALITY_DIMENSIONS = new Set(["ims_client_name", "docupedia_document_name", "tl_name", "am_name"]);
router.get("/quality/breakdown/:dimension", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const dim = req.params.dimension;
  if (!QUALITY_DIMENSIONS.has(dim)) return res.status(400).json({ success: false, message: "Unknown dimension" });
  const data = await svc.getQualityBreakdown(readQueryFilters(req), dim as Parameters<typeof svc.getQualityBreakdown>[1]);
  res.json({ success: true, data });
}));

router.get("/escalations/overview", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await svc.getEscalationOverview(readQueryFilters(req));
  res.json({ success: true, data });
}));
router.get("/escalations/trend", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await svc.getEscalationTrend(readQueryFilters(req), readGranularity(req));
  res.json({ success: true, data });
}));
const ESCALATION_DIMENSIONS = new Set(["ims_client_name", "error_category", "tl_name", "am_name"]);
router.get("/escalations/breakdown/:dimension", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const dim = req.params.dimension;
  if (!ESCALATION_DIMENSIONS.has(dim)) return res.status(400).json({ success: false, message: "Unknown dimension" });
  const data = await svc.getEscalationBreakdown(readQueryFilters(req), dim as Parameters<typeof svc.getEscalationBreakdown>[1]);
  res.json({ success: true, data });
}));
router.get("/escalations/records/:dimension", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const dim = req.params.dimension;
  if (!ESCALATION_DIMENSIONS.has(dim)) return res.status(400).json({ success: false, message: "Unknown dimension" });
  const q = req.query as Record<string, string | undefined>;
  if (q.value === undefined) return res.status(400).json({ success: false, message: "value is required" });
  const data = await svc.getEscalationRecords(
    readQueryFilters(req), dim as Parameters<typeof svc.getEscalationBreakdown>[1], q.value,
    q.limit ? Number(q.limit) : undefined
  );
  res.json({ success: true, data });
}));

const DOC_RAW_DIMENSIONS = new Set(["ims_client_name", "tl_name", "am_name"]);
router.get("/doc-raw/overview", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await svc.getDocRawOverview(readQueryFilters(req));
  res.json({ success: true, data });
}));
router.get("/doc-raw/trend", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await svc.getDocRawTrend(readQueryFilters(req), readGranularity(req));
  res.json({ success: true, data });
}));
router.get("/doc-raw/breakdown/:dimension", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const dim = req.params.dimension;
  if (!DOC_RAW_DIMENSIONS.has(dim)) return res.status(400).json({ success: false, message: "Unknown dimension" });
  const data = await svc.getDocRawBreakdown(readQueryFilters(req), dim as Parameters<typeof svc.getDocRawBreakdown>[1]);
  res.json({ success: true, data });
}));

router.get("/poa/overview", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await svc.getPoaOverview(readQueryFilters(req));
  res.json({ success: true, data });
}));
router.get("/poa/trend", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await svc.getPoaTrend(readQueryFilters(req), readGranularity(req));
  res.json({ success: true, data });
}));
const POA_DIMENSIONS = new Set(["tl_name", "am_name"]);
router.get("/poa/breakdown/:dimension", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const dim = req.params.dimension;
  if (!POA_DIMENSIONS.has(dim)) return res.status(400).json({ success: false, message: "Unknown dimension" });
  const data = await svc.getPoaBreakdown(readQueryFilters(req), dim as Parameters<typeof svc.getPoaBreakdown>[1]);
  res.json({ success: true, data });
}));

// Live/Today — deliberately not range-filtered, see the service's own comment.
router.get("/live/overview", requireAuth, requireRole(...VIEWER_ROLES), h(async (_req, res) => {
  const data = await svc.getLiveOverview();
  res.json({ success: true, data });
}));
const LIVE_DIMENSIONS = new Set(["tl_name", "am_name"]);
router.get("/live/doc-breakdown/:dimension", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const dim = req.params.dimension;
  if (!LIVE_DIMENSIONS.has(dim)) return res.status(400).json({ success: false, message: "Unknown dimension" });
  const data = await svc.getLiveDocBreakdown(dim as Parameters<typeof svc.getLiveDocBreakdown>[0]);
  res.json({ success: true, data });
}));

export const onfidoProcessDashboardRouter = router;
export default router;

