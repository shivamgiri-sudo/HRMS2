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
import { getDrilldown } from "./dashboard-drilldown.service.js";
import {
  getAppointmentEsignMetrics,
  getAttendanceMetrics,
  getBgvMetrics,
  getDpdpWithdrawalMetrics,
  getHeadcountMetrics,
  getIncentiveMetrics,
  getJoiningDocEsignMetrics,
  getNameMismatchMetrics,
  getOnboardingMetrics,
  getPayrollReadinessMetrics,
  getResignationMetrics,
  getTatMetrics,
} from "./dashboard-metric.service.js";

const router = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);
router.use(requireAuth);

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

async function metricBundle(scope: Awaited<ReturnType<typeof resolveDashboardScope>>) {
  const [hc, onb, att, payroll, incentive, tat, resign, dpdp, appointmentEsign, bgv, nm, joiningDocEsign] = await Promise.all([
    getHeadcountMetrics(scope),
    getOnboardingMetrics(scope),
    getAttendanceMetrics(scope),
    getPayrollReadinessMetrics(scope),
    getIncentiveMetrics(scope),
    getTatMetrics(scope),
    getResignationMetrics(scope),
    getDpdpWithdrawalMetrics(scope),
    getAppointmentEsignMetrics(scope),
    getBgvMetrics(scope),
    getNameMismatchMetrics(scope),
    getJoiningDocEsignMetrics(scope),
  ]);
  return { hc, onb, att, payroll, incentive, tat, resign, dpdp, appointmentEsign, bgv, nm, joiningDocEsign };
}

// Specific routes must be registered before /:dashboardCode/* routes.
router.get("/employee/summary", h(async (req: AuthenticatedRequest, res: any) => {
  const { getEmployeeForUser } = await import("../../shared/accessGuard.js");
  const employee = await getEmployeeForUser(req.authUser!.id);
  if (!employee) return res.json({ success: true, data: { metrics: {}, generatedAt: new Date().toISOString() } });

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       SUM(CASE WHEN attendance_status IN ('present','week_off_worked') THEN 1 ELSE 0 END) AS present,
       SUM(CASE WHEN attendance_status = 'half_day' THEN 1 ELSE 0 END) AS half_day,
       SUM(CASE WHEN attendance_status = 'absent' THEN 1 ELSE 0 END) AS absent,
       SUM(CASE WHEN late_mark = 1 THEN 1 ELSE 0 END) AS late,
       SUM(CASE WHEN attendance_status = 'missing_punch' THEN 1 ELSE 0 END) AS missed_punch,
       COUNT(CASE WHEN attendance_status NOT IN ('holiday','week_off') THEN 1 END) AS total_working_days,
       ROUND(
         (SUM(CASE WHEN attendance_status IN ('present','week_off_worked') THEN 1 ELSE 0 END)
          + SUM(CASE WHEN attendance_status = 'half_day' THEN 0.5 ELSE 0 END))
         / NULLIF(COUNT(CASE WHEN attendance_status NOT IN ('holiday','week_off') THEN 1 END), 0) * 100,
         1
       ) AS attendance_pct
     FROM attendance_daily_record
     WHERE employee_id = ?
       AND record_date >= DATE_FORMAT(CONVERT_TZ(NOW(), '+00:00', '+05:30'), '%Y-%m-01')
       AND record_date <= DATE(CONVERT_TZ(NOW(), '+00:00', '+05:30'))`,
    [(employee as any).id],
  ).catch(() => [[{}]] as any);

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
            totalWorkingDays: Number(row?.total_working_days ?? 0),
            attendanceRate: Number(row?.attendance_pct ?? 0),
          },
        },
      },
      generatedAt: new Date().toISOString(),
    },
  });
}));

router.get("/PAYROLL_HR_DASHBOARD/operational-summary", h(async (req: AuthenticatedRequest, res: any) => {
  const { scope } = await requestedScope(req);
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const currentRun = await db.execute<RowDataPacket[]>(
    `SELECT id, run_month, status, run_label, created_at, closed_at, attendance_snapshot_locked, tds_mode
       FROM salary_prep_run
      WHERE run_month = ?
      ORDER BY created_at DESC LIMIT 1`,
    [currentMonth],
  ).then(([rows]) => (rows as any[])[0] ?? null).catch(() => null);

  const salaryBill = currentRun?.id ? await db.execute<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT employee_id) AS emp_count,
            COALESCE(SUM(gross_pay), SUM(gross_salary), SUM(gross_amount), 0) AS total_gross,
            COALESCE(SUM(net_pay), SUM(net_salary), SUM(net_amount), 0) AS total_net,
            COALESCE(SUM(total_deductions), 0) AS total_deductions
       FROM salary_prep_line WHERE run_id = ?`,
    [currentRun.id],
  ).then(([rows]) => (rows as any[])[0] ?? null).catch(() => null) : null;

  const count = async (sql: string, params: unknown[] = []) => db.execute<RowDataPacket[]>(sql, params)
    .then(([rows]) => Number((rows as any[])[0]?.count ?? 0)).catch(() => 0);

  const [salaryHoldCount, optOuts, bankChanges, chequeValidation, advances, fnfPending] = await Promise.all([
    count("SELECT COUNT(*) AS count FROM employees WHERE active_status = 1 AND salary_hold = 1"),
    count("SELECT COUNT(*) AS count FROM employee_statutory_override WHERE status = 'pending'"),
    count("SELECT COUNT(*) AS count FROM employee_bank_change_request WHERE status = 'pending'"),
    count("SELECT COUNT(*) AS count FROM cheque_validation_queue WHERE status = 'pending'"),
    count("SELECT COUNT(*) AS count FROM salary_advance_log WHERE status = 'pending'"),
    count("SELECT COUNT(*) AS count FROM full_final_settlement WHERE status IN ('pending','draft','in_progress')"),
  ]);

  const disbursement = await db.execute<RowDataPacket[]>(
    `SELECT status, COUNT(*) AS count FROM payroll_disbursal WHERE pay_month = ? GROUP BY status`,
    [currentMonth],
  ).then(([rows]) => {
    const result: Record<string, number> = { initiated: 0, in_progress: 0, completed: 0, failed: 0 };
    for (const row of rows as any[]) result[String(row.status)] = Number(row.count ?? 0);
    return result;
  }).catch(() => ({ initiated: 0, in_progress: 0, completed: 0, failed: 0 }));

  const branchReadinessScope = scope.level === "ORG_ALL" || scope.branchIds.length === 0
    ? { sql: "1=1", params: [] as string[] }
    : { sql: `r.branch_id IN (${scope.branchIds.map(() => "?").join(",")})`, params: [...scope.branchIds] };
  const branchReadiness = await db.execute<RowDataPacket[]>(
    `SELECT r.branch_id, b.branch_name, r.readiness_score, r.readiness_status, r.employee_count, r.branch_head_signoff
       FROM payroll_branch_readiness r
       LEFT JOIN branch_master b ON b.id = r.branch_id
      WHERE r.process_month = ? AND ${branchReadinessScope.sql}
      ORDER BY r.readiness_score ASC`,
    [currentMonth, ...branchReadinessScope.params],
  ).then(([rows]) => rows as any[]).catch(() => []);

  const momTrend = await db.execute<RowDataPacket[]>(
    `SELECT spr.run_month,
            COUNT(DISTINCT spl.employee_id) AS headcount,
            COALESCE(SUM(spl.gross_pay), SUM(spl.gross_salary), SUM(spl.gross_amount), 0) AS total_gross,
            COALESCE(SUM(spl.net_pay), SUM(spl.net_salary), SUM(spl.net_amount), 0) AS total_net
       FROM salary_prep_run spr
       JOIN salary_prep_line spl ON spl.run_id = spr.id
      WHERE spr.run_month >= DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 6 MONTH), '%Y-%m')
      GROUP BY spr.run_month
      ORDER BY spr.run_month ASC`,
  ).then(([rows]) => rows as any[]).catch(() => []);

  const statutoryFiling = await db.execute<RowDataPacket[]>(
    `SELECT filing_type, due_date, status, filed_date, amount
       FROM statutory_filing_tracker
      WHERE due_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        AND due_date <= DATE_ADD(CURDATE(), INTERVAL 60 DAY)
      ORDER BY due_date ASC`,
  ).then(([rows]) => rows as any[]).catch(() => []);

  const loans = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS activeLoans,
            COALESCE(SUM(outstanding_amount), 0) AS totalOutstanding,
            SUM(CASE WHEN status = 'overdue' THEN 1 ELSE 0 END) AS overdueLoans,
            COALESCE(SUM(CASE WHEN status = 'overdue' THEN outstanding_amount ELSE 0 END), 0) AS overdueAmount
       FROM employee_loan WHERE status IN ('active','overdue')`,
  ).then(([rows]) => (rows as any[])[0] ?? {}).catch(() => ({}));

  const reimbursements = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS pendingRequests,
            COALESCE(SUM(amount), 0) AS totalPending,
            SUM(CASE WHEN created_at < DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS overdueRequests,
            ROUND(AVG(TIMESTAMPDIFF(DAY, created_at, NOW())), 1) AS avgTat
       FROM reimbursement_claim WHERE status = 'pending'`,
  ).then(([rows]) => (rows as any[])[0] ?? {}).catch(() => ({}));

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
      salaryHoldCount,
      pendingQueues: { optOuts, bankChanges, chequeValidation, advances, total: optOuts + bankChanges + chequeValidation + advances },
      fnfPending,
      disbursement,
      branchReadiness,
      momTrend,
      statutoryFiling,
      loans,
      reimbursements,
      generatedAt: new Date().toISOString(),
    },
  });
}));

router.get("/:dashboardCode/summary", h(async (req: AuthenticatedRequest, res: any) => {
  const { dashboardCode } = req.params;
  const { user, context, scope } = await requestedScope(req);
  const [workItems] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS pending_count,
            SUM(CASE WHEN due_at < NOW() AND status = 'pending' THEN 1 ELSE 0 END) AS overdue_count
       FROM work_item
      WHERE (assigned_to_user_id = ? OR assigned_to_role = ?) AND status = 'pending'`,
    [user.id, context.primaryRole],
  ).catch(() => [[{ pending_count: 0, overdue_count: 0 }]] as any);

  return res.json({
    success: true,
    data: {
      dashboardCode,
      scope,
      workItems: workItems[0] ?? { pending_count: 0, overdue_count: 0 },
      metrics: await metricBundle(scope),
      generatedAt: new Date().toISOString(),
    },
  });
}));

router.get("/:dashboardCode/metric-values", h(async (req: AuthenticatedRequest, res: any) => {
  const { scope } = await requestedScope(req);
  return res.json({ success: true, data: { dashboardCode: req.params.dashboardCode, metrics: await metricBundle(scope), generatedAt: new Date().toISOString() } });
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
  ).catch(() => [[]] as any);
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
  ).catch(() => [[]] as any);
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
  ).catch(() => [[]] as any);
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
  ).catch(() => [[]] as any);

  const [processes] = await db.execute<RowDataPacket[]>(
    `SELECT pm.id, pm.process_name AS name, MIN(e.branch_id) AS branchId
       FROM process_master pm
       LEFT JOIN employees e ON e.process_id = pm.id AND e.active_status = 1
      WHERE pm.active_status = 1 AND ${processScope.sql}
      GROUP BY pm.id, pm.process_name
      ORDER BY pm.process_name`,
    processScope.params,
  ).catch(() => [[]] as any);

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
  ).catch(() => [[]] as any);
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
  ).catch(() => [[]] as any);
  return res.json({ success: true, data: { accountability: (rows as any[]).map((row) => ({ ...row, total: Number(row.total), pending: Number(row.pending), overdue: Number(row.overdue), completed: Number(row.completed), completionRate: Number(row.total) > 0 ? Math.round(Number(row.completed) / Number(row.total) * 100) : 0 })), generatedAt: new Date().toISOString() } });
}));

export { router as dashboardRouter };
