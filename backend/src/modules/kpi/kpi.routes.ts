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
router.get("/leaderboard", requireRole("admin", "hr", "super_admin", "manager", "qa", "process_manager", "branch_head", "ceo", "tl"), h(c.getLeaderboard));

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

// GET /api/kpi/org-summary?period=YYYY-MM — org-wide KPI summary for CEO dashboard
router.get("/org-summary", requireRole("admin", "hr", "super_admin", "ceo", "manager"), h(async (req: AuthenticatedRequest, res: Response) => {
  const period = String(req.query.period ?? "").trim() || new Date().toISOString().slice(0, 7);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       ROUND(AVG(kda.score_pct), 2) AS org_avg_score,
       COUNT(DISTINCT kda.employee_id) AS employees_scored,
       COUNT(DISTINCT kda.process_id) AS processes_covered,
       MAX(kda.score_pct) AS best_score,
       MIN(kda.score_pct) AS lowest_score,
       SUM(CASE WHEN kda.score_pct >= 90 THEN 1 ELSE 0 END) AS high_performers,
       SUM(CASE WHEN kda.score_pct < 60 THEN 1 ELSE 0 END) AS needs_attention
     FROM kpi_daily_actual kda
     WHERE DATE_FORMAT(kda.record_date, '%Y-%m') = ?`,
    [period]
  ).catch(() => [[{}]] as any);

  const [processRows] = await db.execute<RowDataPacket[]>(
    `SELECT
       pm.process_name AS label,
       ROUND(AVG(kda.score_pct), 2) AS avg_score,
       COUNT(DISTINCT kda.employee_id) AS agents
     FROM kpi_daily_actual kda
     JOIN process_master pm ON pm.id = kda.process_id
     WHERE DATE_FORMAT(kda.record_date, '%Y-%m') = ?
     GROUP BY kda.process_id, pm.process_name
     ORDER BY avg_score DESC
     LIMIT 10`,
    [period]
  ).catch(() => [[]] as any);

  const [trendRows] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(record_date, '%Y-%m') AS period, ROUND(AVG(score_pct), 2) AS avg_score
     FROM kpi_daily_actual
     WHERE record_date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
     GROUP BY DATE_FORMAT(record_date, '%Y-%m')
     ORDER BY period ASC`,
    []
  ).catch(() => [[]] as any);

  return res.json({
    success: true,
    data: {
      period,
      summary: rows[0] ?? {},
      by_process: processRows,
      trend: trendRows,
    },
  });
}));

export { router as kpiRouter };
