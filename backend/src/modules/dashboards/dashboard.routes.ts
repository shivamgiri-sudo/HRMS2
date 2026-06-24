import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { resolveDashboardScope } from "../../shared/dashboardScope.js";

const router = Router();
const h = (fn: Function) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

router.get("/:dashboardCode/summary", h(async (req: AuthenticatedRequest, res: any) => {
  const { dashboardCode } = req.params;
  const user = req.authUser!;
  const role = (user as any).role ?? "employee";
  const scope = await resolveDashboardScope(user.id, role);

  // Return scope + recent work items count
  const [workItems] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) as pending_count, SUM(CASE WHEN due_at < NOW() AND status='pending' THEN 1 ELSE 0 END) as overdue_count
     FROM work_item WHERE (assigned_to_user_id = ? OR assigned_to_role = ?) AND status='pending'`,
    [user.id, role]
  ).catch(() => [[{ pending_count: 0, overdue_count: 0 }]] as any);

  return res.json({
    success: true,
    data: {
      dashboardCode,
      scope,
      workItems: workItems[0] ?? { pending_count: 0, overdue_count: 0 },
      generatedAt: new Date().toISOString(),
    },
  });
}));

router.get("/:dashboardCode/metrics", h(async (req: AuthenticatedRequest, res: any) => {
  const role = (req.authUser as any).role ?? "employee";
  const [metrics] = await db.execute<RowDataPacket[]>(
    `SELECT dmc.metric_code, dmc.metric_name, dmc.unit, dmc.higher_is_better, drmc.is_primary, drmc.display_order
     FROM dashboard_metric_catalog dmc
     JOIN dashboard_role_metric_config drmc ON drmc.metric_code = dmc.metric_code
     WHERE drmc.role_code = ? AND drmc.dashboard_code = ? AND dmc.is_active = 1 AND drmc.is_active = 1
     ORDER BY drmc.display_order`,
    [role, req.params.dashboardCode]
  ).catch(() => [[]] as any);
  return res.json({ success: true, data: metrics });
}));

router.get("/:dashboardCode/good-bad-insights", h(async (req: AuthenticatedRequest, res: any) => {
  const user = req.authUser!;
  const role = (user as any).role ?? "employee";

  // Work inbox stats as the basis for good/bad insight
  const [pending] = await db.execute<RowDataPacket[]>(
    `SELECT item_type, priority, COUNT(*) as count,
            SUM(CASE WHEN due_at < NOW() THEN 1 ELSE 0 END) as overdue
     FROM work_item WHERE (assigned_to_user_id = ? OR assigned_to_role = ?) AND status='pending'
     GROUP BY item_type, priority`,
    [user.id, role]
  ).catch(() => [[]] as any);

  const good = (pending as any[]).filter((r: any) => r.overdue === 0 || r.overdue === "0");
  const bad = (pending as any[]).filter((r: any) => Number(r.overdue) > 0);

  return res.json({
    success: true,
    data: {
      good: { count: good.reduce((a: number, r: any) => a + Number(r.count), 0), items: good },
      bad: { count: bad.reduce((a: number, r: any) => a + Number(r.count), 0), items: bad },
    },
  });
}));

router.get("/:dashboardCode/metric/:metricCode/drilldown", h(async (req: AuthenticatedRequest, res: any) => {
  // Return empty drilldown structure — to be populated per metric
  return res.json({ success: true, data: { metricCode: req.params.metricCode, drilldown: [], note: "Metric-specific drilldown pending implementation" } });
}));

export { router as dashboardRouter };
