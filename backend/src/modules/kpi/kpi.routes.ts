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
import { emptyOnError, getKpiOrgSummary } from "./kpi-org-summary.js";

export { emptyOnError };

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
router.get("/summary/:employeeId/:templateId/:period",
  requireRole("admin", "hr", "super_admin", "manager", "qa", "employee"),
  (req: any, res: any, next: any) => {
    const isPrivileged = ["admin", "super_admin", "hr", "manager", "qa"].includes(req.authUser?.role ?? "");
    if (!isPrivileged && req.params.employeeId !== req.authUser?.id) {
      return res.status(403).json({ error: "You can only view your own scores" });
    }
    return next();
  },
  h(c.getEmployeeSummary)
);
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

  return res.json({ success: true, data: await getKpiOrgSummary(period, scope) });
}));

export { router as kpiRouter };
