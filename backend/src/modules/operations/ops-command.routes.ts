import type { Request, Response } from "express";
import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { dashboardConsumerRoles } from "../../shared/dashboardAccessRegistry.js";
import { getUserRoleContext } from "../../shared/roleResolver.js";
import {
  DashboardScopeConfigurationError,
  narrowDashboardScope,
  resolveDashboardScope,
} from "../../shared/dashboardScope.js";
import { logger } from "../../logger.js";
import {
  NONE_ID,
  OPS_DIMENSIONS,
  addDays,
  resolvePeriod,
  type OpsCtx,
  type OpsDimension,
} from "./ops-command.context.js";
import { OPS_METRICS, type OpsRecordDomain } from "./ops-command.definitions.js";
import { computePerformance, type PerfSource } from "./ops-command.performance.js";
import { computeCohorts, computeForecast, computeFreshness, computeInsights } from "./ops-command.insights.js";
import { writeAuditLog } from "../../shared/auditLog.js";
import { scheduleOpsIndexes } from "./ops-command.indexes.js";
import { computeEmployee360 } from "./ops-command.agent360.js";
import { computeAgentDays } from "./ops-command.agent.js";
import { getOperationsAnalyticsSummary } from "./operations-analytics.service.js";
import { HEAT_METRICS, computeHeatmap, type HeatMetric } from "./ops-command.heatmap.js";
import { computeEmployeeDetail, computeRecords, employeeInScope } from "./ops-command.records.js";
import { computeFilterOptions, computeGroups, computeRows, computeTrend, computeTotals } from "./ops-command.service.js";
import { previousPeriod } from "./ops-command.context.js";

const router = Router();

// Operations Analytics (Dashboard)
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);
router.get("/analytics", requireAuth, requireRole("super_admin", "admin", "operations", "ceo", "coo"), h(async (req, res) => {
  const summary = await getOperationsAnalyticsSummary();
  res.json({ success: true, data: summary });
}));

/** Everyone the Operations dashboard is registered for, plus the roles the legacy v2 page already served. */
const ALLOWED_ROLES = [
  ...new Set([
    ...dashboardConsumerRoles("OPERATIONS_DASHBOARD"),
    "super_admin", "admin", "ceo", "coo", "management", "hr", "hr_admin", "ho_operations", "operations_head",
    "operations_manager", "operations", "branch_head", "branch_manager", "bm", "process_manager", "manager",
    "assistant_manager", "team_leader", "team_lead", "tl",
  ]),
];

const OPS_METRIC_IDS = new Set(OPS_METRICS.map((m) => m.id));

const RECORD_DOMAINS = new Set<OpsRecordDomain>([
  "headcount", "joiners", "exits", "notice", "absent", "late", "unrostered", "warnings", "pip", "training_risk", "low_quality", "at_risk",
]);

class BadRequest extends Error {}

const str = (v: unknown): string | undefined => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, 64) : undefined;
};

async function buildCtx(req: Request): Promise<OpsCtx> {
  const userId = (req as any).authUser!.id as string;
  const ctxRole = await getUserRoleContext(userId);
  let scope = await resolveDashboardScope(userId, ctxRole.primaryRole);
  // A person-only scope means the role has no branch / process mapping — this page is for operations staff.
  if (scope.level === "SELF_ONLY") throw new BadRequest("SELF_SCOPE");

  const branchId = str(req.query.branchId);
  const processId = str(req.query.processId);
  scope = await narrowDashboardScope(scope, branchId === NONE_ID ? undefined : branchId, processId === NONE_ID ? undefined : processId);

  const period = await resolvePeriod(req.query.from, req.query.to);
  return {
    scope,
    attThrough: period.attThrough,
    today: period.today,
    f: { from: period.from, to: period.to, branchId, processId, lobId: str(req.query.lobId), managerId: str(req.query.managerId) },
  };
}

function guard(handler: (req: Request, res: Response, ctx: OpsCtx) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      const ctx = await buildCtx(req);
      res.setHeader("Cache-Control", "no-store");
      await handler(req, res, ctx);
    } catch (err) {
      if (err instanceof DashboardScopeConfigurationError) {
        return res.status(err.statusCode).json({ success: false, code: err.code, message: err.message });
      }
      if (err instanceof BadRequest) {
        const selfScope = err.message === "SELF_SCOPE";
        return res.status(selfScope ? 403 : 400).json({
          success: false,
          message: selfScope ? "Your role has no branch or process scope for the Operations dashboard." : err.message,
        });
      }
      logger.error(`[ops-command] ${req.method} ${req.path} failed`, err);
      return res.status(500).json({ success: false, message: "Failed to load Operations data" });
    }
  };
}

const dimOf = (v: unknown, fallback: OpsDimension): OpsDimension => {
  const s = str(v) as OpsDimension | undefined;
  if (!s) return fallback;
  if (!OPS_DIMENSIONS.includes(s)) throw new BadRequest(`Invalid groupBy. Use ${OPS_DIMENSIONS.join("|")}.`);
  return s;
};

const intOf = (v: unknown, def: number, min: number, max: number) => Math.min(Math.max(parseInt(String(v ?? ""), 10) || def, min), max);

const auth = [requireAuth, requireRole(...ALLOWED_ROLES)];

router.get("/definitions", ...auth, (_req, res) => {
  res.json({ success: true, data: { metrics: OPS_METRICS } });
});

router.get("/filters", ...auth, guard(async (_req, res, ctx) => {
  const options = await computeFilterOptions(ctx);
  res.json({ success: true, data: { ...options, period: { from: ctx.f.from, to: ctx.f.to, attendanceThrough: ctx.attThrough, today: ctx.today } } });
}));

router.get("/summary", ...auth, guard(async (req, res, ctx) => {
  const dim = dimOf(req.query.groupBy, "branch");
  const dir = req.query.dir === "asc" ? "asc" : "desc";
  const [totals, groups] = await Promise.all([
    computeTotals(ctx, false),
    computeGroups(ctx, dim, str(req.query.sort) ?? "hc_closing", dir, intOf(req.query.limit, 300, 1, 1000)),
  ]);
  res.json({
    success: true,
    data: {
      period: { from: ctx.f.from, to: ctx.f.to, attendanceThrough: ctx.attThrough, today: ctx.today },
      scopeLevel: ctx.scope.level,
      totals: { current: totals.current, previous: totals.previous },
      groupBy: dim,
      rows: groups.rows,
      totalRows: groups.total,
      externalQualityAvailable: totals.externalQualityAvailable && groups.externalQualityAvailable,
    },
  });
}));

/** Previous-period totals for the delta chips — separate so the page can render before this finishes. */
router.get("/previous", ...auth, guard(async (_req, res, ctx) => {
  const prev = previousPeriod(ctx.f);
  const { rows } = await computeRows({ ...ctx, f: { ...ctx.f, ...prev } }, "all");
  res.json({ success: true, data: { period: prev, totals: rows.get("all") ?? {} } });
}));

router.get("/trend", ...auth, guard(async (_req, res, ctx) => {
  res.json({ success: true, data: { points: await computeTrend(ctx) } });
}));

router.get("/performance", ...auth, guard(async (req, res, ctx) => {
  const source = str(req.query.source);
  const data = await computePerformance(ctx, dimOf(req.query.groupBy, "process"), source === "agent" || source === "process" ? (source as PerfSource) : undefined);
  res.json({ success: true, data });
}));

router.get("/insights", ...auth, guard(async (_req, res, ctx) => {
  res.json({ success: true, data: { insights: await computeInsights(ctx) } });
}));

router.get("/cohorts", ...auth, guard(async (_req, res, ctx) => {
  res.json({ success: true, data: { cohorts: await computeCohorts(ctx) } });
}));

router.get("/forecast", ...auth, guard(async (_req, res, ctx) => {
  res.json({ success: true, data: await computeForecast(ctx) });
}));

router.get("/freshness", ...auth, guard(async (_req, res, ctx) => {
  res.json({ success: true, data: { feeds: await computeFreshness(ctx.today), today: ctx.today } });
}));

/** CSV of the drill table (scope-limited, audited). Cells that could be read as spreadsheet formulas are neutralised. */
router.get("/export", ...auth, guard(async (req, res, ctx) => {
  const dim = dimOf(req.query.groupBy, "branch");
  const ids = String(req.query.columns ?? "").split(",").map((c) => c.trim()).filter((c) => OPS_METRIC_IDS.has(c)).slice(0, 40);
  if (!ids.length) throw new BadRequest("columns is required.");
  const { rows } = await computeGroups(ctx, dim, str(req.query.sort) ?? "hc_closing", req.query.dir === "asc" ? "asc" : "desc", 1000);
  const defs = ids.map((id) => OPS_METRICS.find((m) => m.id === id)!);
  const esc = (v: unknown) => {
    let t = v === null || v === undefined ? "" : String(v);
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(t)) t = `'${t}`;
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const lines = [
    [dim, "Detail", ...defs.map((d) => d.label)].map(esc).join(","),
    ...rows.map((r) => [r.name, r.sub ?? "", ...ids.map((id) => r.m[id])].map(esc).join(",")),
  ];
  await writeAuditLog({
    actor_user_id: (req as any).authUser!.id, action_type: "operations_command_export", module_key: "operations",
    entity_type: "operations_dashboard", req,
    metadata: { groupBy: dim, columns: ids, rows: rows.length, period: { from: ctx.f.from, to: ctx.f.to }, scope: ctx.scope.level, filters: { branchId: ctx.f.branchId, processId: ctx.f.processId, lobId: ctx.f.lobId, managerId: ctx.f.managerId } },
  });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="operations-${dim}-${ctx.f.from}_${ctx.f.to}.csv"`);
  res.send("\uFEFF" + lines.join("\r\n"));
}));

router.get("/records", ...auth, guard(async (req, res, ctx) => {
  const domain = str(req.query.domain) as OpsRecordDomain | undefined;
  if (!domain || !RECORD_DOMAINS.has(domain)) throw new BadRequest("Invalid domain.");
  const day = str(req.query.date);
  if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) ctx.f = { ...ctx.f, from: day, to: day };
  const groupDim = req.query.groupBy ? dimOf(req.query.groupBy, "all") : undefined;
  const data = await computeRecords(ctx, domain, { dim: groupDim, id: str(req.query.groupId) }, intOf(req.query.limit, 50, 1, 200), intOf(req.query.offset, 0, 0, 100000));
  res.json({ success: true, data });
}));

router.get("/heatmap", ...auth, guard(async (req, res, ctx) => {
  const metric = (str(req.query.metric) ?? "attendance") as HeatMetric;
  if (!HEAT_METRICS.includes(metric)) throw new BadRequest("Invalid metric.");
  res.json({ success: true, data: await computeHeatmap(ctx, dimOf(req.query.groupBy, "process"), metric) });
}));

router.get("/employee/:employeeId/days", ...auth, guard(async (req, res, ctx) => {
  // Row scope first: an out-of-scope employee must look identical to a missing one.
  if (!(await employeeInScope(ctx, String(req.params.employeeId)))) {
    return res.status(404).json({ success: false, message: "Employee not found in your scope" });
  }
  const horizon = addDays(ctx.today, 7);
  const to = ctx.f.to < horizon ? ctx.f.to : horizon;
  const floor = addDays(to, -91);
  const from = ctx.f.from > floor ? ctx.f.from : floor;
  const data = await computeAgentDays(String(req.params.employeeId), from, to);
  res.json({ success: true, data });
}));

router.get("/employee/:employeeId", ...auth, guard(async (req, res, ctx) => {
  const data = await computeEmployee360(ctx, String(req.params.employeeId));
  if (!data) return res.status(404).json({ success: false, message: "Employee not found in your scope" });
  res.json({ success: true, data });
}));

export default router;

/**
 * Keeps the shared fact cache warm so the first person to open the page after a quiet spell is not the one who pays for
 * the table scans. Disable with OPS_PREWARM=false. Timers are unref'd so they never hold the process open.
 */
async function prewarm(): Promise<void> {
  try {
    const p = await resolvePeriod(undefined, undefined);
    const ctx = { scope: { level: "ORG_ALL", branchIds: [], processIds: [], employeeIds: [], userId: "prewarm", role: "system" }, f: { from: p.from, to: p.to }, attThrough: p.attThrough, today: p.today } as OpsCtx;
    await computeRows(ctx, "all");
    await computeRows({ ...ctx, f: { ...ctx.f, ...previousPeriod(ctx.f) } }, "all");
  } catch (err) {
    logger.warn(`[ops-command] prewarm skipped: ${(err as Error).message}`);
  }
}

if (process.env.OPS_PREWARM !== "false" && process.env.NODE_ENV !== "test") {
  setTimeout(() => void prewarm(), 20_000).unref();
  setInterval(() => void prewarm(), 4 * 60 * 1000).unref();
}

// Performance indexes are created in the background, never by a startup migration (see ops-command.indexes.ts).
scheduleOpsIndexes();
