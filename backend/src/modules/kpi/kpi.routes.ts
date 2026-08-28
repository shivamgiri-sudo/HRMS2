import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { requireScopedRole } from "../../middleware/scopeMiddleware.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { kpiController as c } from "./kpi.controller.js";
import { kpiService } from "./kpi.service.js";
import { logSourceFailure } from "../../shared/apiResponse.js";
import { buildScopeWhere, resolveDashboardScopeForRequest } from "../../shared/dashboardScope.js";
import { getUserRoleContext } from "../../shared/roleResolver.js";
import { dashboardConsumerRoles } from "../../shared/dashboardAccessRegistry.js";

/**
 * Swallow a KPI query failure into an empty row set, but always log it.
 * These reads previously discarded ER_BAD_FIELD_ERROR silently, so a query against
 * nonexistent columns returned HTTP 200 with empty data indefinitely.
 */
export function emptyOnError(
  context: string,
  detail: Record<string, unknown> = {},
  failures?: string[],
) {
  return (err: unknown) => {
    logSourceFailure("kpi", err, { query: context, ...detail });
    // Record the miss for the caller as well as the log. Logging alone told
    // operators something broke but still handed the UI an empty result that
    // reads as "nothing happened this period" — the two are not the same
    // answer, and only one of them means someone should look at it.
    failures?.push(context);
    return [[]] as any;
  };
}


const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

// Metrics
router.get("/metrics", requireRole("admin", "hr", "super_admin", "manager", "qa", "process_manager"), h(c.listMetrics));
router.post("/metrics", requireRole("admin", "super_admin", "manager", "process_manager"), h(c.createMetric));

// Templates
router.get("/templates", requireRole("admin", "hr", "super_admin", "manager", "qa", "process_manager"), h(c.listTemplates));
router.post("/templates", requireRole("admin", "super_admin", "manager", "process_manager"), h(c.createTemplate));
router.get("/templates/:id/metrics", requireRole("admin", "hr", "super_admin", "manager", "qa", "process_manager"), h(c.listTemplateMetrics));
router.post("/templates/:id/metrics", requireRole("admin", "super_admin", "manager", "process_manager"), h(c.addTemplateMetric));

// Assignments — static path before dynamic
router.post("/assignments",
  requireRole("admin", "super_admin", "manager", "process_manager"),
  requireScopedRole(["manager", "process_manager"], async (req) => {
    // Resolve employee's branch/process
    const [rows] = await db.execute(
      'SELECT branch_id, process_id FROM employees WHERE id = ? LIMIT 1',
      [req.body.employee_id]
    ) as any[];
    const emp = rows[0];
    return {
      branchId: emp?.branch_id,
      processId: emp?.process_id
    };
  }),
  h(c.assignTemplate)
);
router.get("/assignments/employee/:employeeId", requireRole("admin", "hr", "super_admin", "manager", "qa"), h(c.getEmployeeTemplate));  // TODO: Add self-scope

// Scores — static path before dynamic
router.post("/scores/bulk",
  requireRole("admin", "super_admin", "manager", "qa"),
  requireScopedRole(["manager", "qa"], async (req) => {
    // Bulk scores - check first employee's scope
    const firstEmpId = req.body.scores?.[0]?.employee_id;
    if (!firstEmpId) return {};
    const [rows] = await db.execute(
      'SELECT branch_id, process_id FROM employees WHERE id = ? LIMIT 1',
      [firstEmpId]
    ) as any[];
    const emp = rows[0];
    return {
      branchId: emp?.branch_id,
      processId: emp?.process_id
    };
  }),
  h(c.bulkRecordScores)
);
router.post("/scores", requireRole("admin", "manager", "qa"), h(c.recordScore));  // TODO: Add self-scope for employees

// Summary + Leaderboard
router.get("/summary/:employeeId/:templateId/:period", requireRole("admin", "hr", "super_admin", "manager", "qa"), h(c.getEmployeeSummary));  // TODO: Add self-scope
router.get("/leaderboard", requireRole("admin", "hr", "super_admin", "manager", "qa", "process_manager", "branch_head", "ceo", "team_leader"), h(c.getLeaderboard));

// Family summary — aggregated scores per family for a process/period
router.get("/family-summary/:processId/:period", requireRole("admin", "hr", "super_admin", "manager"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { processId, period } = req.params;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    return res.status(400).json({ error: "period must be YYYY-MM" });
  }
  const data = await kpiService.getFamilySummary(processId, period);
  res.json({ success: true, data });
}));

// Per-process KPI config
router.get("/process-config/:processId", requireRole("admin", "hr", "super_admin", "manager"), h(async (req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT kpc.*, km.metric_name, km.metric_code, km.category AS metric_type, km.unit,
            ktm.target_value AS template_default
     FROM kpi_process_config kpc
     JOIN kpi_metric_master km
       ON km.id = CONVERT(kpc.metric_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
     LEFT JOIN kpi_template_metric ktm
       ON ktm.metric_id = CONVERT(kpc.metric_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
     WHERE kpc.process_id = ?
     ORDER BY km.metric_name`,
    [req.params.processId]
  );
  res.json({ success: true, data: rows });
}));

router.post("/process-config/:processId", requireRole("admin", "hr", "super_admin", "process_manager"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { metric_id, target_value, min_threshold, max_achievement, weightage } = req.body;
  if (!metric_id || target_value === undefined) return res.status(400).json({ error: "metric_id and target_value required" });
  await db.execute(
    `INSERT INTO kpi_process_config (id, process_id, metric_id, target_value, min_threshold, max_achievement, weightage, created_by)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE target_value=VALUES(target_value), min_threshold=VALUES(min_threshold), max_achievement=VALUES(max_achievement), weightage=VALUES(weightage), updated_at=NOW()`,
    [req.params.processId, metric_id, target_value, min_threshold ?? null, max_achievement ?? 120, weightage ?? 100, req.authUser!.id]
  );
  res.json({ success: true });
}));

router.delete("/process-config/:processId/:metricId", requireRole("admin", "hr", "super_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  await db.execute("DELETE FROM kpi_process_config WHERE process_id=? AND metric_id=?", [req.params.processId, req.params.metricId]);
  res.json({ success: true });
}));

router.get("/rating-config", h(async (req: AuthenticatedRequest, res: Response) => {
  const processId = req.query.process_id as string | undefined;
  let rows: RowDataPacket[];
  if (processId) {
    const [r] = await db.execute<RowDataPacket[]>(
      `SELECT MIN(id) as id, process_id, rating_label, MIN(min_score_pct) as min_score_pct, MAX(max_score_pct) as max_score_pct, color_code
       FROM kpi_rating_config WHERE process_id=? OR process_id IS NULL
       GROUP BY process_id, rating_label, color_code
       ORDER BY process_id DESC, min_score_pct DESC`,
      [processId]
    );
    rows = r as RowDataPacket[];
  } else {
    const [r] = await db.execute<RowDataPacket[]>(
      `SELECT MIN(id) as id, process_id, rating_label, MIN(min_score_pct) as min_score_pct, MAX(max_score_pct) as max_score_pct, color_code
       FROM kpi_rating_config
       GROUP BY process_id, rating_label, color_code
       ORDER BY process_id IS NULL DESC, min_score_pct DESC`
    );
    rows = r as RowDataPacket[];
  }
  res.json({ success: true, data: rows });
}));

router.put("/rating-config/:processId", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { ratings } = req.body as { ratings: { rating_label: string; min_score_pct: number; max_score_pct: number; color_code?: string }[] };
  if (!Array.isArray(ratings)) return res.status(400).json({ error: "ratings array required" });
  await db.execute("DELETE FROM kpi_rating_config WHERE process_id=?", [req.params.processId]);
  for (const r of ratings) {
    await db.execute(
      "INSERT INTO kpi_rating_config (id, process_id, rating_label, min_score_pct, max_score_pct, color_code) VALUES (UUID(),?,?,?,?,?)",
      [req.params.processId, r.rating_label, r.min_score_pct, r.max_score_pct, r.color_code ?? null]
    );
  }
  res.json({ success: true });
}));

/**
 * GET /api/kpi/org-summary?period=YYYY-MM — org KPI rollup for the CEO dashboard.
 *
 * Rebuilt because the previous implementation was unusable in three separate ways:
 *
 *  1. It selected `kda.score_pct`, `kda.process_id` and `kda.record_date`, none of
 *     which exist on kpi_daily_actual (the real columns are `actual_value`,
 *     `score_date`, and there is no process column). Every query raised
 *     ER_BAD_FIELD_ERROR, which was then swallowed into an HTTP 200 with empty data —
 *     so the panel was permanently blank with no error anywhere.
 *  2. `kpi_score_summary` is the table this endpoint looks like it wants, but it holds
 *     zero rows in production. The live data is in kpi_daily_actual.
 *  3. `actual_value` mixes units in one column — percent, seconds, count and currency,
 *     ranging 0 to 56,299. Averaging across it blends rupees with seconds.
 *
 * Consequently there is no single honest "org score". Rather than invent one, this
 * reports a NAMED headline metric (the percent-unit metric with the most samples in
 * the period) and returns the full per-metric breakdown alongside it, so the number on
 * the tile is always attributable to a specific metric.
 */
// Derived from the registry: the CEO, Super Admin and Manager layouts render the org KPI
// rollup. The literal list covered `manager` but none of the other Manager-dashboard roles,
// so branch heads and team leaders saw an empty KPI panel.
router.get("/org-summary", requireRole("admin", "hr", ...dashboardConsumerRoles(
  "CEO_DASHBOARD", "SUPER_ADMIN_DASHBOARD", "MANAGEMENT_DASHBOARD",
)), h(async (req: AuthenticatedRequest, res: Response) => {
  const period = String(req.query.period ?? "").trim() || new Date().toISOString().slice(0, 7);

  // Row scope: this endpoint allows `manager`, who must not receive org-wide KPI.
  // kpi_daily_actual has no branch/process column (process_id_at_event exists but is
  // unpopulated), so scope routes through the employee.
  const roleContext = await getUserRoleContext(req.authUser!.id);
  const scope = await resolveDashboardScopeForRequest(req.authUser!, roleContext.primaryRole);
  const empScope = buildScopeWhere(scope, "e.branch_id", "e.process_id");

  // Any guarded query that fails pushes its name here, so the response can say
  // "the source failed" rather than "there is no data".
  const sourceFailures: string[] = [];

  const [metricRows] = await db.execute<RowDataPacket[]>(
    `SELECT m.metric_code, m.metric_name, m.unit, m.direction,
            ROUND(AVG(a.actual_value), 2) AS avg_value,
            COUNT(DISTINCT a.employee_id) AS employees,
            COUNT(*) AS samples
       FROM kpi_daily_actual a
       JOIN kpi_metric_master m ON m.id = a.metric_id
       LEFT JOIN employees e ON e.id = a.employee_id
      WHERE DATE_FORMAT(a.score_date, '%Y-%m') = ? AND ${empScope.sql}
      GROUP BY m.id
      ORDER BY samples DESC`,
    [period, ...empScope.params],
  ).catch(emptyOnError("kpi org-summary by_metric", { period }, sourceFailures));

  const byMetric = (metricRows as any[]) ?? [];

  // ATTENDANCE_PCT has by far the widest coverage and would otherwise win headline
  // selection, but attendance has a single system of record: attendance_daily_record,
  // the processed attendance engine that payroll is computed from. The KPI copy is a
  // derived nightly roll-up from the dialer feed and disagrees materially with it
  // (~45% vs ~75% present for the same population). Attendance is therefore reported
  // only from attendance_daily_record via the ATTENDANCE metric; the KPI duplicate is
  // excluded from the headline so the two can never appear as competing figures.
  const HEADLINE_EXCLUDED = new Set(["ATTENDANCE_PCT"]);

  const headline =
    byMetric.find((row) =>
      String(row.unit) === "percent" &&
      String(row.direction) === "higher_is_better" &&
      !HEADLINE_EXCLUDED.has(String(row.metric_code))) ?? null;

  let summary: Record<string, unknown> = {};
  let processRows: RowDataPacket[] = [];
  let trendRows: RowDataPacket[] = [];

  if (headline) {
    const [summaryRows] = await db.execute<RowDataPacket[]>(
      `SELECT ROUND(AVG(a.actual_value), 2) AS org_avg_score,
              COUNT(DISTINCT a.employee_id) AS employees_scored,
              COUNT(DISTINCT e.process_id) AS processes_covered,
              ROUND(MAX(a.actual_value), 2) AS best_score,
              ROUND(MIN(a.actual_value), 2) AS lowest_score,
              SUM(CASE WHEN a.actual_value >= 90 THEN 1 ELSE 0 END) AS high_performers,
              SUM(CASE WHEN a.actual_value < 60 THEN 1 ELSE 0 END) AS needs_attention,
              COUNT(*) AS sample_count
         FROM kpi_daily_actual a
         JOIN kpi_metric_master m ON m.id = a.metric_id AND m.metric_code = ?
         LEFT JOIN employees e ON e.id = a.employee_id
        WHERE DATE_FORMAT(a.score_date, '%Y-%m') = ? AND ${empScope.sql}`,
      [headline.metric_code, period, ...empScope.params],
    ).catch(emptyOnError("kpi org-summary rollup", { period }, sourceFailures));

    summary = {
      ...((summaryRows as any[])[0] ?? {}),
      metric_code: headline.metric_code,
      metric_name: headline.metric_name,
      metric_unit: headline.unit,
    };

    // process_id_at_event is present on kpi_daily_actual but 0% populated, so the
    // per-process split must come from the employee's current process.
    [processRows] = await db.execute<RowDataPacket[]>(
      `SELECT pm.process_name AS label,
              ROUND(AVG(a.actual_value), 2) AS avg_score,
              COUNT(DISTINCT a.employee_id) AS agents
         FROM kpi_daily_actual a
         JOIN kpi_metric_master m ON m.id = a.metric_id AND m.metric_code = ?
         JOIN employees e ON e.id = a.employee_id
         JOIN process_master pm ON pm.id = e.process_id
        WHERE DATE_FORMAT(a.score_date, '%Y-%m') = ? AND ${empScope.sql}
        GROUP BY e.process_id, pm.process_name
        ORDER BY avg_score DESC
        LIMIT 10`,
      [headline.metric_code, period, ...empScope.params],
    ).catch(emptyOnError("kpi org-summary by_process", { period }, sourceFailures));

    [trendRows] = await db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(a.score_date, '%Y-%m') AS period,
              ROUND(AVG(a.actual_value), 2) AS avg_score
         FROM kpi_daily_actual a
         JOIN kpi_metric_master m ON m.id = a.metric_id AND m.metric_code = ?
         LEFT JOIN employees e ON e.id = a.employee_id
        WHERE a.score_date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH) AND ${empScope.sql}
        GROUP BY DATE_FORMAT(a.score_date, '%Y-%m')
        ORDER BY period ASC`,
      [headline.metric_code, ...empScope.params],
    ).catch(emptyOnError("kpi org-summary trend", { period }, sourceFailures));
  }

  return res.json({
    success: true,
    data: {
      period,
      summary,
      by_process: processRows,
      by_metric: byMetric,
      trend: trendRows,
      // A failed query and an empty period are different answers. Saying "no
      // actuals were recorded" when the query actually errored is what makes
      // real breakage look like a quiet month.
      ...(sourceFailures.length
        ? {
            unavailableSources: {
              kpi: `${sourceFailures.length} KPI source quer${sourceFailures.length === 1 ? "y" : "ies"} ` +
                `failed for ${period} — the figures below are incomplete, not zero`,
              failedQueries: sourceFailures,
            },
          }
        : headline
          ? {}
          : {
              unavailableSources: {
                kpi: byMetric.length
                  ? `No higher-is-better percent KPI is available as a headline for ${period}`
                  : `No KPI actuals were recorded for ${period}`,
              },
            }),
    },
  });
}));

export { router as kpiRouter };
