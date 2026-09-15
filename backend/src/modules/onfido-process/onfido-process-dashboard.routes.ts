import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import * as svc from "./onfido-process-dashboard.service.js";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { readableProcessIds } from "../process-operations/process-operations.service.js";

const router = Router();
type AsyncHandler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const h = (fn: AsyncHandler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};

/** Who may open the Onfido process dashboard. super_admin short-circuits requireRole. */
const VIEWER_ROLES = [
  "admin", "ceo", "coo", "manager", "process_manager", "team_leader",
  "branch_head", "qa", "quality_analyst", "wfm", "branch_wfm",
] as const;

/**
 * Branch/process scope, on top of the role check. This dashboard lives inside
 * Process Operations, whose picker offers Onfido only to users scoped to it
 * (readableProcessIds: all / branch / process assignments; super_admin, admin
 * and ceo see everything). Without the same check here, a branch-scoped user
 * from another branch — a wfm user in Ahmedabad, say — could still read Onfido
 * by calling this API directly.
 */
let onfidoProcessId: string | null = null;
async function requireOnfidoScope(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    if (!onfidoProcessId) {
      const [rows] = await db.execute<RowDataPacket[]>(
        "SELECT id FROM process_master WHERE process_code = 'ONFIDO' LIMIT 1");
      onfidoProcessId = rows[0] ? String(rows[0].id) : null;
    }
    const allowed = await readableProcessIds(req.authUser!.id);
    if (!onfidoProcessId || !allowed.has(onfidoProcessId)) {
      res.status(403).json({ success: false, message: "Onfido is outside your branch or process scope." });
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
}
router.use(requireAuth, requireOnfidoScope);

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
router.get("/attrition/aon-monthly", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await svc.getAttritionAonMonthly(readQueryFilters(req));
  res.json({ success: true, data });
}));
router.get("/attrition/reason-monthly", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await svc.getAttritionReasonMonthly(readQueryFilters(req));
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
const ETM_DIMENSIONS = new Set(["tl_name", "am_name", "escalated_by_email", "aon_bucket"]);
router.get("/etm/breakdown/:queue/:dimension", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const { queue, dimension } = req.params;
  if (queue !== "doc" && queue !== "poa") return res.status(400).json({ success: false, message: "Unknown queue" });
  if (!ETM_DIMENSIONS.has(dimension)) return res.status(400).json({ success: false, message: "Unknown dimension" });
  const data = await svc.getEtmBreakdown(readQueryFilters(req), queue, dimension as Parameters<typeof svc.getEtmBreakdown>[2]);
  res.json({ success: true, data });
}));
router.get("/etm/latest-day/:queue/:dimension", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const { queue, dimension } = req.params;
  if (queue !== "doc" && queue !== "poa") return res.status(400).json({ success: false, message: "Unknown queue" });
  if (!ETM_DIMENSIONS.has(dimension)) return res.status(400).json({ success: false, message: "Unknown dimension" });
  const data = await svc.getEtmLatestDayBreakdown(readQueryFilters(req), queue, dimension as Parameters<typeof svc.getEtmLatestDayBreakdown>[2]);
  res.json({ success: true, data });
}));
const ETM_PIVOT_DIMENSIONS = new Set(["analyst", "slot", "client", "document_type"]);
router.get("/etm/day-pivot/:queue/:by", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const { queue, by } = req.params;
  if (queue !== "doc" && queue !== "poa") return res.status(400).json({ success: false, message: "Unknown queue" });
  if (!ETM_PIVOT_DIMENSIONS.has(by)) return res.status(400).json({ success: false, message: "Unknown pivot dimension" });
  const data = await svc.getEtmDayPivot(readQueryFilters(req), queue, by as Parameters<typeof svc.getEtmDayPivot>[2]);
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
router.get("/task-skip/latest-day/:dimension", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const dim = req.params.dimension;
  if (!TASK_SKIP_DIMENSIONS.has(dim)) return res.status(400).json({ success: false, message: "Unknown dimension" });
  const data = await svc.getTaskSkipLatestDayBreakdown(readQueryFilters(req), dim as Parameters<typeof svc.getTaskSkipLatestDayBreakdown>[1]);
  res.json({ success: true, data });
}));
const TASK_SKIP_PIVOT_DIMENSIONS = new Set(["analyst", "slot", "client", "task_type"]);
router.get("/task-skip/day-pivot/:by", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const by = req.params.by;
  if (!TASK_SKIP_PIVOT_DIMENSIONS.has(by)) return res.status(400).json({ success: false, message: "Unknown pivot dimension" });
  const data = await svc.getTaskSkipDayPivot(readQueryFilters(req), by as Parameters<typeof svc.getTaskSkipDayPivot>[1]);
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

// Item #6 of the 2026-09-12 feedback: "DOC Check and POA Client and document
// wise need report" — filter by Document Name, month/week trend, Client Name
// / Task / AHT table.
function readClientDocFilters(req: AuthenticatedRequest) {
  const q = req.query as Record<string, string | undefined>;
  return { from: q.from, to: q.to, tlName: q.tlName, amName: q.amName, documentName: q.documentName };
}
router.get("/client-doc/overview", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await svc.getClientDocOverview(readClientDocFilters(req));
  res.json({ success: true, data });
}));
router.get("/client-doc/trend", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const granularity = q.granularity === "weekly" ? "weekly" : "monthly";
  const data = await svc.getClientDocTrend(readClientDocFilters(req), granularity);
  res.json({ success: true, data });
}));
router.get("/client-doc/breakdown", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await svc.getClientDocBreakdown(readClientDocFilters(req));
  res.json({ success: true, data });
}));
router.get("/client-doc/document-options", requireAuth, requireRole(...VIEWER_ROLES), h(async (_req, res) => {
  const data = await svc.getClientDocDocumentOptions();
  res.json({ success: true, data });
}));
router.get("/client-doc/records", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  if (q.clientName === undefined || (q.task !== "DOC" && q.task !== "POA")) {
    return res.status(400).json({ success: false, message: "clientName and task ('DOC'|'POA') are required" });
  }
  const data = await svc.getClientDocRecords(
    readClientDocFilters(req), q.clientName, q.task, q.limit ? Number(q.limit) : undefined
  );
  res.json({ success: true, data });
}));

// Item #7: POA External Dashboard (new format, onfido_poa_external_raw). Row
// drill-down uses the generic /records/ONFIDO_POA_EXTERNAL_RAW route above —
// no dedicated detail route needed, same as DOC Raw/POA below.
const POA_EXTERNAL_DIMENSIONS = new Set(["ims_client_name", "tl_name", "am_name", "location"]);
router.get("/poa-external/overview", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await svc.getPoaExternalOverview(readQueryFilters(req));
  res.json({ success: true, data });
}));
router.get("/poa-external/trend", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await svc.getPoaExternalTrend(readQueryFilters(req), readGranularity(req));
  res.json({ success: true, data });
}));
router.get("/poa-external/breakdown/:dimension", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const dim = req.params.dimension;
  if (!POA_EXTERNAL_DIMENSIONS.has(dim)) return res.status(400).json({ success: false, message: "Unknown dimension" });
  const data = await svc.getPoaExternalBreakdown(readQueryFilters(req), dim as Parameters<typeof svc.getPoaExternalBreakdown>[1]);
  res.json({ success: true, data });
}));

// Item #8: GD MCN SLA APS (day & slot wise, onfido_gd_mcn_sla_raw). Only
// from/to filters — no TL/AM dimension in this file. Row drill-down uses the
// generic /records/ONFIDO_GD_MCN_SLA route, same as POA External above.
router.get("/gd-mcn-sla/overview", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await svc.getGdMcnSlaOverview(readQueryFilters(req));
  res.json({ success: true, data });
}));
router.get("/gd-mcn-sla/trend", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await svc.getGdMcnSlaTrend(readQueryFilters(req));
  res.json({ success: true, data });
}));
router.get("/gd-mcn-sla/slot-breakdown", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await svc.getGdMcnSlaSlotBreakdown(readQueryFilters(req));
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

router.get("/poa-trial/overview", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await svc.getPoaTrialOverview(readQueryFilters(req));
  res.json({ success: true, data });
}));
router.get("/poa-trial/trend", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const data = await svc.getPoaTrialTrend(readQueryFilters(req), readGranularity(req));
  res.json({ success: true, data });
}));
const POA_TRIAL_DIMENSIONS = new Set(["tl_name", "am_name"]);
router.get("/poa-trial/breakdown/:dimension", requireAuth, requireRole(...VIEWER_ROLES), h(async (req, res) => {
  const dim = req.params.dimension;
  if (!POA_TRIAL_DIMENSIONS.has(dim)) return res.status(400).json({ success: false, message: "Unknown dimension" });
  const data = await svc.getPoaTrialBreakdown(readQueryFilters(req), dim as Parameters<typeof svc.getPoaTrialBreakdown>[1]);
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

