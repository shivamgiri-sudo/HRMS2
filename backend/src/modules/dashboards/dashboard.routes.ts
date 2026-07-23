import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import {
  buildScopeWhere,
  narrowDashboardScope,
  resolveDashboardScope,
} from "../../shared/dashboardScope.js";
import { getUserRoleContext } from "../../shared/roleResolver.js";
import {
  canAccessDashboard,
  getDashboardDefinition,
  type DashboardCode,
} from "../../shared/dashboardAccessRegistry.js";
import { getDrilldown } from "./dashboard-drilldown.service.js";
import { executeDashboardMetrics } from "./dashboard-definition.service.js";
import { dashboardSummarySchema } from "../../shared/dashboardMetricContract.js";

const router = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);
router.use(requireAuth);

function dashboardAccessError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}

async function requireDashboardEntitlement(
  req: AuthenticatedRequest,
  dashboardCode: string,
): Promise<void> {
  const definition = getDashboardDefinition(dashboardCode);
  if (!definition) {
    throw dashboardAccessError("Dashboard not found", 404);
  }
  const context = await getUserRoleContext(req.authUser!.id);
  if (!canAccessDashboard(definition.code, context.roleKeys)) {
    throw dashboardAccessError(`Not entitled to ${definition.code}`, 403);
  }
  req.params.dashboardCode = definition.code;
}

router.param("dashboardCode", (req, _res, next, dashboardCode) => {
  requireDashboardEntitlement(req as AuthenticatedRequest, dashboardCode)
    .then(() => next())
    .catch(next);
});

router.get("/access-registry", h(async (req: AuthenticatedRequest, res: any) => {
  const context = await getUserRoleContext(req.authUser!.id);
  const { DASHBOARD_ACCESS_REGISTRY } = await import("../../shared/dashboardAccessRegistry.js");
  const dashboards = Object.values(DASHBOARD_ACCESS_REGISTRY)
    .filter((item) => canAccessDashboard(item.code, context.roleKeys))
    .map(({ allowedRoleKeys: _allowedRoleKeys, ...item }) => item);
  return res.json({ success: true, data: { dashboards } });
}));

const requireFixedDashboard = (dashboardCode: DashboardCode) =>
  (req: AuthenticatedRequest, _res: any, next: any) => {
    requireDashboardEntitlement(req, dashboardCode).then(() => next()).catch(next);
  };

async function requestedScope(req: AuthenticatedRequest) {
  const user = req.authUser!;
  const context = await getUserRoleContext(user.id);
  const base = await resolveDashboardScope(user.id, context.primaryRole);
  const scope = await narrowDashboardScope(
    base,
    String(req.query.branchId ?? ""),
    String(req.query.processId ?? ""),
  );
  return { user, context, scope };
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

// Specific routes must be registered before /:dashboardCode/* routes.
router.get("/employee/summary", requireFixedDashboard("EMPLOYEE_SELF_DASHBOARD"), h(async (req: AuthenticatedRequest, res: any) => {
  const { getEmployeeForUser } = await import("../../shared/accessGuard.js");
  const employee = await getEmployeeForUser(req.authUser!.id);
  if (!employee) {
    throw Object.assign(
      new Error("Employee mapping is required for the self dashboard"),
      { statusCode: 409, errorCode: "EMPLOYEE_MAPPING_UNAVAILABLE" },
    );
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       SUM(CASE WHEN attendance_status IN ('present','week_off_worked') THEN 1 ELSE 0 END) AS present,
       SUM(CASE WHEN attendance_status = 'half_day' THEN 1 ELSE 0 END) AS half_day,
       SUM(CASE WHEN attendance_status = 'absent' THEN 1 ELSE 0 END) AS absent,
       SUM(CASE WHEN late_mark = 1 THEN 1 ELSE 0 END) AS late,
       SUM(CASE WHEN attendance_status = 'missing_punch' THEN 1 ELSE 0 END) AS missed_punch,
       SUM(CASE WHEN attendance_status IN ('on_leave','leave','leave_approved') THEN 1 ELSE 0 END) AS on_leave,
       COUNT(CASE WHEN attendance_status NOT IN ('holiday','week_off') THEN 1 END) AS total_working_days,
       COUNT(CASE WHEN attendance_status NOT IN ('holiday','week_off','on_leave','leave','leave_approved') THEN 1 END) AS expected_to_work,
       ROUND(
         (SUM(CASE WHEN attendance_status IN ('present','week_off_worked') THEN 1 ELSE 0 END)
          + SUM(CASE WHEN attendance_status = 'half_day' THEN 0.5 ELSE 0 END))
         / NULLIF(COUNT(CASE WHEN attendance_status NOT IN ('holiday','week_off','on_leave','leave','leave_approved') THEN 1 END), 0) * 100,
         1
       ) AS attendance_pct
     FROM attendance_daily_record
     WHERE employee_id = ?
       AND record_date >= DATE_FORMAT(CONVERT_TZ(NOW(), '+00:00', '+05:30'), '%Y-%m-01')
       AND record_date <= DATE(CONVERT_TZ(NOW(), '+00:00', '+05:30'))`,
    [(employee as any).id],
  );

  const row = rows[0] as any;
  return res.json({
    success: true,
    data: {
      metrics: {
        att: {
          value: Number(row?.attendance_pct ?? 0),
          detail: {
            present: Number(row?.present ?? 0),
            halfDay: Number(row?.half_day ?? 0),
            absent: Number(row?.absent ?? 0),
            late: Number(row?.late ?? 0),
            missedPunch: Number(row?.missed_punch ?? 0),
            onLeave: Number(row?.on_leave ?? 0),
            totalWorkingDays: Number(row?.total_working_days ?? 0),
            expectedToWork: Number(row?.expected_to_work ?? 0),
            attendanceRate: Number(row?.attendance_pct ?? 0),
          },
        },
      },
      generatedAt: new Date().toISOString(),
    },
  });
}));

router.get("/PAYROLL_HR_DASHBOARD/operational-summary", requireFixedDashboard("PAYROLL_HR_DASHBOARD"), h(async (req: AuthenticatedRequest, res: any) => {
  const { scope } = await requestedScope(req);
  const runId = String(req.query.runId ?? "").trim();
  if (!runId) {
    throw Object.assign(new Error("Select a payroll run"), {
      statusCode: 400,
      errorCode: "PAYROLL_RUN_REQUIRED",
    });
  }

  const currentRun = await db.execute<RowDataPacket[]>(
    `SELECT id, run_month, status, run_label, created_at, closed_at, attendance_snapshot_locked, tds_mode
       FROM salary_prep_run
      WHERE id = ?`,
    [runId],
  ).then(([rows]) => (rows as any[])[0] ?? null);
  if (!currentRun) {
    throw Object.assign(new Error("Payroll run not found"), {
      statusCode: 404,
      errorCode: "PAYROLL_RUN_NOT_FOUND",
    });
  }
  const currentMonth = String(currentRun.run_month);

  const salaryScope = buildScopeWhere(scope, "e.branch_id", "e.process_id");
  const salaryBill = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT spl.employee_id) AS emp_count,
            COALESCE(SUM(spl.gross_pay), SUM(spl.gross_salary), SUM(spl.gross_amount), 0) AS total_gross,
            COALESCE(SUM(spl.net_pay), SUM(spl.net_salary), SUM(spl.net_amount), 0) AS total_net,
            COALESCE(SUM(spl.total_deductions), 0) AS total_deductions
       FROM salary_prep_line spl
       JOIN employees e ON e.id = spl.employee_id
      WHERE spl.run_id = ? AND ${salaryScope.sql}`,
    [currentRun.id, ...salaryScope.params],
  ).then(([rows]) => (rows as any[])[0] ?? null);

  return res.json({
    success: true,
    data: {
      currentMonth,
      currentRun: currentRun ? {
        id: currentRun.id,
        month: currentRun.run_month,
        status: currentRun.status ?? "draft",
        label: currentRun.run_label,
        attendanceLocked: Boolean(currentRun.attendance_snapshot_locked),
        tdsMode: currentRun.tds_mode,
        createdAt: currentRun.created_at,
        closedAt: currentRun.closed_at,
      } : null,
      salaryBill: salaryBill ? {
        employeeCount: Number(salaryBill.emp_count ?? 0),
        totalGross: Number(salaryBill.total_gross ?? 0),
        totalNet: Number(salaryBill.total_net ?? 0),
        totalDeductions: Number(salaryBill.total_deductions ?? 0),
      } : null,
      unavailableSources: {
        pendingQueues: "Queue records are not linked to a payroll run",
        disbursement: "Disbursement records are month-linked, not run-linked",
        branchReadiness: "Readiness records are month-linked, not run-linked",
        statutoryFiling: "Filing records are not linked to a payroll run",
        loans: "Loan aggregates are not linked to a payroll run",
        reimbursements: "Reimbursement aggregates are not linked to a payroll run",
      },
      generatedAt: new Date().toISOString(),
    },
  });
}));

router.get("/:dashboardCode/export", h(async (req: AuthenticatedRequest, res: any) => {
  const dashboardCode = req.params.dashboardCode as DashboardCode;
  const definition = getDashboardDefinition(dashboardCode)!;
  if (!definition.permissions.export) {
    throw Object.assign(new Error("Dashboard export is not permitted"), {
      statusCode: 403,
      errorCode: "DASHBOARD_EXPORT_FORBIDDEN",
    });
  }

  const { scope } = await requestedScope(req);
  const generatedAt = new Date();
  const metrics = await executeDashboardMetrics(dashboardCode, scope, generatedAt);
  const header = [
    "dashboard_code",
    "metric_code",
    "value",
    "unit",
    "status",
    "available",
    "numerator",
    "denominator",
    "period_start",
    "period_end",
    "timezone",
    "as_of",
  ];
  const rows = Object.values(metrics).map((metric) => [
    dashboardCode,
    metric.code,
    metric.value,
    metric.unit,
    metric.status,
    metric.available,
    metric.numerator,
    metric.denominator,
    metric.periodStart,
    metric.periodEnd,
    metric.timezone,
    metric.asOf,
  ]);
  const csv = [header, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${dashboardCode.toLowerCase()}-${generatedAt.toISOString().slice(0, 10)}.csv"`,
  );
  return res.status(200).send(`\uFEFF${csv}`);
}));

router.get("/:dashboardCode/summary", h(async (req: AuthenticatedRequest, res: any) => {
  const dashboardCode = req.params.dashboardCode as DashboardCode;
  const { user, context, scope } = await requestedScope(req);
  const [workItems] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS pending_count,
            SUM(CASE WHEN due_at < NOW() AND status = 'pending' THEN 1 ELSE 0 END) AS overdue_count
       FROM work_item
      WHERE (assigned_to_user_id = ? OR assigned_to_role = ?) AND status = 'pending'`,
    [user.id, context.primaryRole],
  );

  const generatedAt = new Date();
  const data = dashboardSummarySchema.parse({
    dashboardCode,
    scope,
    workItems: workItems[0],
    metrics: await executeDashboardMetrics(dashboardCode, scope, generatedAt),
    generatedAt: generatedAt.toISOString(),
  });
  return res.json({ success: true, data });
}));

router.get("/:dashboardCode/metric-values", h(async (req: AuthenticatedRequest, res: any) => {
  const { scope } = await requestedScope(req);
  const dashboardCode = req.params.dashboardCode as DashboardCode;
  const generatedAt = new Date();
  return res.json({
    success: true,
    data: {
      dashboardCode,
      metrics: await executeDashboardMetrics(dashboardCode, scope, generatedAt),
      generatedAt: generatedAt.toISOString(),
    },
  });
}));

router.get("/:dashboardCode/metrics", h(async (req: AuthenticatedRequest, res: any) => {
  const context = await getUserRoleContext(req.authUser!.id);
  const [metrics] = await db.execute<RowDataPacket[]>(
    `SELECT dmc.metric_code, dmc.metric_name, dmc.unit, dmc.higher_is_better, drmc.is_primary, drmc.display_order
       FROM dashboard_metric_catalog dmc
       JOIN dashboard_role_metric_config drmc ON drmc.metric_code = dmc.metric_code
      WHERE drmc.role_code = ? AND drmc.dashboard_code = ? AND dmc.is_active = 1 AND drmc.is_active = 1
      ORDER BY drmc.display_order`,
    [context.primaryRole, req.params.dashboardCode],
  );
  return res.json({ success: true, data: metrics });
}));

router.get("/:dashboardCode/good-bad-insights", h(async (req: AuthenticatedRequest, res: any) => {
  const context = await getUserRoleContext(req.authUser!.id);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT item_type, priority, COUNT(*) AS count, SUM(CASE WHEN due_at < NOW() THEN 1 ELSE 0 END) AS overdue
       FROM work_item
      WHERE (assigned_to_user_id = ? OR assigned_to_role = ?) AND status = 'pending'
      GROUP BY item_type, priority`,
    [req.authUser!.id, context.primaryRole],
  );
  const good = (rows as any[]).filter((row) => Number(row.overdue) === 0);
  const bad = (rows as any[]).filter((row) => Number(row.overdue) > 0);
  return res.json({ success: true, data: { good: { count: good.reduce((sum, row) => sum + Number(row.count), 0), items: good }, bad: { count: bad.reduce((sum, row) => sum + Number(row.count), 0), items: bad } } });
}));

router.get("/:dashboardCode/metric/:metricCode/drilldown", h(async (req: AuthenticatedRequest, res: any) => {
  const { scope } = await requestedScope(req);
  const result = await getDrilldown(req.params.metricCode, scope, req.query as Record<string, unknown>);
  return res.json({ success: true, data: result });
}));

router.get("/:dashboardCode/metric/:metricCode/trend", h(async (req: AuthenticatedRequest, res: any) => {
  const { context, scope } = await requestedScope(req);
  const scoped = buildScopeWhere(scope, "branch_id", "process_id");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT snapshot_date AS snapshotDate, metric_value AS value, metric_status AS status
       FROM dashboard_metric_snapshot
      WHERE dashboard_code = ? AND metric_code = ? AND role_code = ?
        AND snapshot_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        AND ${scoped.sql}
      ORDER BY snapshot_date ASC`,
    [req.params.dashboardCode, req.params.metricCode, context.primaryRole, ...scoped.params],
  );
  return res.json({ success: true, data: { metricCode: req.params.metricCode, dashboardCode: req.params.dashboardCode, points: rows, periodDays: 30 } });
}));

router.get("/:dashboardCode/filters", h(async (req: AuthenticatedRequest, res: any) => {
  const { scope } = await requestedScope(req);
  const branchScope = buildScopeWhere(scope, "bm.id", "pm.id");
  const processScope = buildScopeWhere(scope, "e.branch_id", "pm.id");

  const [branches] = await db.execute<RowDataPacket[]>(
    `SELECT bm.id, bm.branch_name AS name
       FROM branch_master bm
      WHERE bm.active_status = 1
        AND ${scope.level === "ORG_ALL" ? "1=1" : branchScope.sql.replaceAll("pm.id", "NULL")}
      ORDER BY bm.branch_name`,
    scope.level === "ORG_ALL" ? [] : branchScope.params,
  );

  const [processes] = await db.execute<RowDataPacket[]>(
    `SELECT pm.id, pm.process_name AS name, MIN(e.branch_id) AS branchId
       FROM process_master pm
       LEFT JOIN employees e ON e.process_id = pm.id AND e.active_status = 1
      WHERE pm.active_status = 1 AND ${processScope.sql}
      GROUP BY pm.id, pm.process_name
      ORDER BY pm.process_name`,
    processScope.params,
  );

  return res.json({ success: true, data: { branches, processes, scope: { level: scope.level } } });
}));

router.get("/:dashboardCode/root-causes", h(async (req: AuthenticatedRequest, res: any) => {
  const { scope } = await requestedScope(req);
  const scoped = buildScopeWhere(scope, "b.branch_id", "b.process_id");
  const [onboarding] = await db.execute<RowDataPacket[]>(
    `SELECT b.id AS entityId, CONCAT(c.first_name, ' ', COALESCE(c.last_name,'')) AS label, b.bridge_status AS detail
       FROM ats_onboarding_bridge b
       LEFT JOIN ats_candidate c ON c.id = b.candidate_id
      WHERE (b.bridge_status = 'stuck' OR (b.bridge_status IN ('pending','in_progress') AND b.updated_at < DATE_SUB(NOW(), INTERVAL 3 DAY)))
        AND ${scoped.sql}
      ORDER BY b.updated_at ASC LIMIT 3`,
    scoped.params,
  );
  return res.json({ success: true, data: { rootCauses: (onboarding as any[]).map((row) => ({ domain: "ONBOARDING", label: row.label, entityId: row.entityId, count: 1, severity: "warn", detail: row.detail })), generatedAt: new Date().toISOString() } });
}));

router.get("/:dashboardCode/owner-accountability", h(async (req: AuthenticatedRequest, res: any) => {
  const { context } = await requestedScope(req);
  // Scope to items assigned to this user or their primary role — prevents cross-role data leakage
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT assigned_to_role AS role, COUNT(*) AS total,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN status = 'pending' AND due_at < NOW() THEN 1 ELSE 0 END) AS overdue,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed
       FROM work_item
      WHERE assigned_to_role IS NOT NULL
        AND (assigned_to_user_id = ? OR assigned_to_role = ?)
      GROUP BY assigned_to_role
      ORDER BY overdue DESC, pending DESC`,
    [req.authUser!.id, context.primaryRole],
  );
  return res.json({ success: true, data: { accountability: (rows as any[]).map((row) => ({ ...row, total: Number(row.total), pending: Number(row.pending), overdue: Number(row.overdue), completed: Number(row.completed), completionRate: Number(row.total) > 0 ? Math.round(Number(row.completed) / Number(row.total) * 100) : 0 })), generatedAt: new Date().toISOString() } });
}));

export { router as dashboardRouter };
