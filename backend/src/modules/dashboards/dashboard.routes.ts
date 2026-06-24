import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { resolveDashboardScope } from "../../shared/dashboardScope.js";
import { getDrilldown } from "./dashboard-drilldown.service.js";
import {
  getHeadcountMetrics,
  getOnboardingMetrics,
  getAttendanceMetrics,
  getPayrollReadinessMetrics,
  getIncentiveMetrics,
  getTatMetrics,
  getResignationMetrics,
  getBgvMetrics,
  getNameMismatchMetrics,
} from "./dashboard-metric.service.js";

const router = Router();
const h = (fn: Function) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

// ─── Summary ──────────────────────────────────────────────────────────────────
router.get("/:dashboardCode/summary", h(async (req: AuthenticatedRequest, res: any) => {
  const { dashboardCode } = req.params;
  const user = req.authUser!;
  const role = (user as any).role ?? "employee";
  const scope = await resolveDashboardScope(user.id, role);

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

// ─── Metrics catalog ──────────────────────────────────────────────────────────
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

// ─── Good/Bad insights ────────────────────────────────────────────────────────
router.get("/:dashboardCode/good-bad-insights", h(async (req: AuthenticatedRequest, res: any) => {
  const user = req.authUser!;
  const role = (user as any).role ?? "employee";

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

// ─── Real metric values ───────────────────────────────────────────────────────
router.get("/:dashboardCode/metric-values", h(async (req: AuthenticatedRequest, res: any) => {
  const user = req.authUser!;
  const role = (user as any).role ?? "employee";
  const scope = await resolveDashboardScope(user.id, role);

  const [headcount, onboarding, attendance, payroll, incentive, tat, resignation, bgv, nameMismatch] =
    await Promise.all([
      getHeadcountMetrics(scope),
      getOnboardingMetrics(scope),
      getAttendanceMetrics(scope),
      getPayrollReadinessMetrics(scope),
      getIncentiveMetrics(scope),
      getTatMetrics(scope),
      getResignationMetrics(scope),
      getBgvMetrics(scope),
      getNameMismatchMetrics(scope),
    ]);

  const replaceApi = (m: ReturnType<typeof getHeadcountMetrics> extends Promise<infer T> ? T : never, code: string) => ({
    ...m,
    drilldownApi: `/api/dashboards/${req.params.dashboardCode}/metric/${code}/drilldown`,
  });

  return res.json({
    success: true,
    data: {
      dashboardCode: req.params.dashboardCode,
      generatedAt: new Date().toISOString(),
      metrics: {
        HEADCOUNT: replaceApi(headcount as any, "HEADCOUNT"),
        ONBOARDING: replaceApi(onboarding as any, "ONBOARDING_PENDING"),
        ATTENDANCE: replaceApi(attendance as any, "ATTENDANCE"),
        PAYROLL_READINESS: replaceApi(payroll as any, "PAYROLL_READINESS"),
        INCENTIVE: replaceApi(incentive as any, "INCENTIVE_PENDING"),
        TAT: replaceApi(tat as any, "TAT_BREACHED"),
        RESIGNATION: replaceApi(resignation as any, "RESIGNATION_PENDING"),
        BGV: replaceApi(bgv as any, "BGV"),
        NAME_MISMATCH: replaceApi(nameMismatch as any, "NAME_MISMATCH"),
      },
    },
  });
}));

// ─── Drilldown ────────────────────────────────────────────────────────────────
router.get("/:dashboardCode/metric/:metricCode/drilldown", h(async (req: AuthenticatedRequest, res: any) => {
  const user = req.authUser!;
  const role = (user as any).role ?? "employee";
  const scope = await resolveDashboardScope(user.id, role);
  const { metricCode } = req.params;
  const filters = req.query as Record<string, unknown>;

  const result = await getDrilldown(metricCode, scope, filters);
  return res.json({ success: true, data: result });
}));

// ─── Trend snapshots (last 30 days) ──────────────────────────────────────────
router.get("/:dashboardCode/metric/:metricCode/trend", h(async (req: AuthenticatedRequest, res: any) => {
  const { dashboardCode, metricCode } = req.params;
  const user = req.authUser!;
  const role = (user as any).role ?? "employee";

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       snapshot_date AS snapshotDate,
       metric_value AS value,
       metric_status AS status
     FROM dashboard_metric_snapshot
     WHERE dashboard_code = ? AND metric_code = ? AND role_code = ?
       AND snapshot_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
     ORDER BY snapshot_date ASC`,
    [dashboardCode, metricCode, role]
  ).catch(() => [[]] as any);

  return res.json({
    success: true,
    data: {
      metricCode,
      dashboardCode,
      points: rows,
      periodDays: 30,
    },
  });
}));

// ─── Filters (branches and processes scoped to user) ─────────────────────────
router.get("/:dashboardCode/filters", h(async (req: AuthenticatedRequest, res: any) => {
  const user = req.authUser!;
  const role = (user as any).role ?? "employee";
  const scope = await resolveDashboardScope(user.id, role);

  let branchQuery = "SELECT id, branch_name AS name FROM branches WHERE is_active = 1 ORDER BY branch_name";
  let branchParams: unknown[] = [];
  if (scope.level !== "ORG_ALL" && scope.branchIds.length > 0) {
    branchQuery = `SELECT id, branch_name AS name FROM branches WHERE id IN (${scope.branchIds.map(() => "?").join(",")}) AND is_active = 1 ORDER BY branch_name`;
    branchParams = scope.branchIds;
  }

  let processQuery = "SELECT id, process_name AS name, branch_id AS branchId FROM org_process WHERE is_active = 1 ORDER BY process_name";
  let processParams: unknown[] = [];
  if (scope.level !== "ORG_ALL" && scope.processIds.length > 0) {
    processQuery = `SELECT id, process_name AS name, branch_id AS branchId FROM org_process WHERE id IN (${scope.processIds.map(() => "?").join(",")}) AND is_active = 1 ORDER BY process_name`;
    processParams = scope.processIds;
  }

  const [branches] = await db.execute<RowDataPacket[]>(branchQuery, branchParams).catch(() => [[]] as any);
  const [processes] = await db.execute<RowDataPacket[]>(processQuery, processParams).catch(() => [[]] as any);

  return res.json({
    success: true,
    data: {
      branches,
      processes,
      scope: { level: scope.level },
    },
  });
}));

// ─── Root causes (top 3 blockers per domain) ─────────────────────────────────
router.get("/:dashboardCode/root-causes", h(async (req: AuthenticatedRequest, res: any) => {
  const user = req.authUser!;
  const role = (user as any).role ?? "employee";
  const scope = await resolveDashboardScope(user.id, role);

  // TAT top 3 breaches
  const [tatRows] = await db.execute<RowDataPacket[]>(
    `SELECT task_type AS label, COUNT(*) AS count,
            MAX(TIMESTAMPDIFF(HOUR, due_at, NOW())) AS maxAgeHours
     FROM task_tat_instance WHERE status = 'sla_breached'
     GROUP BY task_type ORDER BY count DESC LIMIT 3`
  ).catch(() => [[]] as any);

  // Name mismatch top 3 blocking candidates
  const [nmRows] = await db.execute<RowDataPacket[]>(
    `SELECT nm.candidate_id AS entityId,
            CONCAT(c.first_name, ' ', c.last_name) AS label,
            nm.mismatch_fields AS detail
     FROM candidate_name_match_summary nm
     LEFT JOIN ats_candidate c ON c.id = nm.candidate_id
     WHERE nm.is_blocking = 1
     ORDER BY nm.created_at ASC LIMIT 3`
  ).catch(() => [[]] as any);

  // Onboarding top 3 stuck
  const [obRows] = await db.execute<RowDataPacket[]>(
    `SELECT b.id AS entityId,
            CONCAT(c.first_name, ' ', c.last_name) AS label,
            b.bridge_status AS detail
     FROM ats_onboarding_bridge b
     LEFT JOIN ats_candidate c ON c.id = b.candidate_id
     WHERE b.bridge_status = 'stuck'
     ORDER BY b.created_at ASC LIMIT 3`
  ).catch(() => [[]] as any);

  const rootCauses = [
    ...(tatRows as any[]).map((r: any) => ({
      domain: "TAT",
      label: r.label,
      count: Number(r.count),
      severity: "critical",
      detail: { maxAgeHours: r.maxAgeHours },
    })),
    ...(nmRows as any[]).map((r: any) => ({
      domain: "NAME_MISMATCH",
      label: r.label,
      entityId: r.entityId,
      count: 1,
      severity: "critical",
      detail: r.detail,
    })),
    ...(obRows as any[]).map((r: any) => ({
      domain: "ONBOARDING",
      label: r.label,
      entityId: r.entityId,
      count: 1,
      severity: "warn",
      detail: r.detail,
    })),
  ];

  return res.json({
    success: true,
    data: { rootCauses, generatedAt: new Date().toISOString() },
  });
}));

// ─── Owner accountability (work_item grouped by role) ────────────────────────
router.get("/:dashboardCode/owner-accountability", h(async (req: AuthenticatedRequest, res: any) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       assigned_to_role AS role,
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
       SUM(CASE WHEN status = 'pending' AND due_at < NOW() THEN 1 ELSE 0 END) AS overdue,
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed
     FROM work_item
     WHERE assigned_to_role IS NOT NULL
     GROUP BY assigned_to_role
     ORDER BY overdue DESC, pending DESC`
  ).catch(() => [[]] as any);

  return res.json({
    success: true,
    data: {
      accountability: (rows as any[]).map((r: any) => ({
        role: r.role,
        total: Number(r.total),
        pending: Number(r.pending),
        overdue: Number(r.overdue),
        completed: Number(r.completed),
        completionRate: Number(r.total) > 0
          ? Math.round((Number(r.completed) / Number(r.total)) * 100)
          : 0,
      })),
      generatedAt: new Date().toISOString(),
    },
  });
}));

export { router as dashboardRouter };
