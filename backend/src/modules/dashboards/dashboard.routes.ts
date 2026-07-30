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
import { getUnifiedInboxSummary } from "../work-inbox/work-inbox.service.js";
import { executeDashboardMetrics, isMetricConfiguredForDashboard } from "./dashboard-definition.service.js";
import { dashboardSummarySchema } from "../../shared/dashboardMetricContract.js";
import {
  HALF_DAY_STATUS,
  LEAVE_STATUSES,
  NON_WORKING_STATUSES,
  attendedDaysSql,
  expectedToWorkSql,
  presentSql,
  statusList,
} from "../../shared/attendanceStatus.js";

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

function requireDashboardMetric(dashboardCode: DashboardCode, metricCode: string): void {
  if (!isMetricConfiguredForDashboard(dashboardCode, metricCode)) {
    throw dashboardAccessError("Metric is not configured for this dashboard", 404);
  }
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
    // Status vocabulary is shared with the org-wide ATTENDANCE metric via
    // shared/attendanceStatus.ts so this employee's percentage here and on the
    // CEO/WFM dashboards are computed identically.
    `SELECT
       ${presentSql()} AS present,
       SUM(CASE WHEN attendance_status = '${HALF_DAY_STATUS}' THEN 1 ELSE 0 END) AS half_day,
       SUM(CASE WHEN attendance_status = 'absent' THEN 1 ELSE 0 END) AS absent,
       SUM(CASE WHEN late_mark = 1 THEN 1 ELSE 0 END) AS late,
       SUM(CASE WHEN attendance_status = 'missing_punch' THEN 1 ELSE 0 END) AS missed_punch,
       SUM(CASE WHEN attendance_status IN (${statusList(LEAVE_STATUSES)}) THEN 1 ELSE 0 END) AS on_leave,
       COUNT(CASE WHEN attendance_status NOT IN (${statusList(NON_WORKING_STATUSES)}) THEN 1 END) AS total_working_days,
       ${expectedToWorkSql()} AS expected_to_work,
       ROUND(
         ${attendedDaysSql()} / NULLIF(${expectedToWorkSql()}, 0) * 100,
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

  // salary_prep_run has no `run_label` and no `closed_at` — neither has ever existed in
  // any migration, so this endpoint raised ER_BAD_FIELD_ERROR and returned 500 on every
  // payroll dashboard load. The label is derived below; `auto_closed_at` is the real
  // closure timestamp (294_payroll_window_closure.sql).
  const currentRun = await db.execute<RowDataPacket[]>(
    `SELECT id, run_month, status, branch_filter, total_employees, created_at,
            auto_closed_at, attendance_snapshot_locked, tds_mode
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
    // gross_pay / gross_amount / net_pay / net_amount exist in no migration. COALESCE
    // does not protect against unknown identifiers — MySQL resolves them before
    // evaluating — so the old chain guaranteed a 500 rather than a fallback.
    `SELECT COUNT(DISTINCT spl.employee_id) AS emp_count,
            COALESCE(SUM(spl.gross_salary), 0) AS total_gross,
            COALESCE(SUM(spl.net_salary), 0) AS total_net,
            COALESCE(SUM(spl.total_deductions), 0) AS total_deductions
       FROM salary_prep_line spl
       JOIN employees e ON e.id = spl.employee_id
      WHERE spl.run_id = ? AND ${salaryScope.sql}`,
    [currentRun.id, ...salaryScope.params],
  ).then(([rows]) => (rows as any[])[0] ?? null);

  // The run has no stored label; compose a stable one so the existing `currentRun.label`
  // contract on the frontend keeps working.
  const runLabel = [currentRun.run_month, currentRun.branch_filter].filter(Boolean).join(" · ");

  const totalGross = Number(salaryBill?.total_gross ?? 0);
  const totalNet = Number(salaryBill?.total_net ?? 0);

  // A previous version of this check warned whenever net exceeded gross, calling it
  // "arithmetically impossible". That was wrong, and it fired on ~1,983 lines across
  // eight runs.
  //
  // salary_prep_line.gross_salary holds the employee's CONTRACTUAL monthly gross — it
  // equals employees.gross_salary on 267 of 279 sampled lines. net_salary is computed
  // from the actual component rows, which include INCENTIVE (Rs 15.4M) and PORTFOLIO
  // (Rs 6.5M) earnings that are not part of contractual gross. Verified on the largest
  // outlier: components sum to 62,247 earnings less 528 deductions = 61,719, exactly the
  // stored net, against a contractual gross of 20,801. Comparing the two compares
  // different things, so the warning was noise that would train viewers to ignore it.
  //
  // What IS worth surfacing is the opposite direction: a line whose net is LOWER than its
  // own components, i.e. an employee with recorded earnings who is being paid nothing.
  // Every one of the 649 mismatches in the sampled run was this case, and 56 of them
  // belong to ACTIVE employees — 49 of whom have no attendance record for the month at
  // all, while 692 of 712 paid active employees do.
  const dataIntegrity: string[] = [];
  const unpaidActive = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS unpaid_lines,
            COALESCE(ROUND(SUM(agg.earn), 2), 0) AS earnings_recorded
       FROM salary_prep_line l
       JOIN employees e ON e.id = l.employee_id
       JOIN (SELECT line_id,
                    SUM(CASE WHEN component_type = 'earning' THEN amount ELSE 0 END) AS earn
               FROM salary_prep_line_component
              GROUP BY line_id) agg ON agg.line_id = l.id
      WHERE l.run_id = ?
        AND l.net_salary = 0
        AND agg.earn > 0
        AND e.active_status = 1
        AND ${salaryScope.sql}`,
    [currentRun.id, ...salaryScope.params],
  ).then(([rows]) => (rows as any[])[0] ?? null);

  const unpaidLines = Number(unpaidActive?.unpaid_lines ?? 0);
  if (unpaidLines > 0) {
    dataIntegrity.push(
      `${unpaidLines} active employee(s) in this run have earning components totalling ` +
        `${unpaidActive.earnings_recorded} but a net pay of zero. Most have no attendance ` +
        `record for the period, so this is likely the attendance-exception backlog ` +
        `reaching payroll — check the attendance exceptions panel before approving.`,
    );
  }

  return res.json({
    success: true,
    data: {
      currentMonth,
      currentRun: currentRun ? {
        id: currentRun.id,
        month: currentRun.run_month,
        status: currentRun.status ?? "draft",
        label: runLabel,
        totalEmployees: currentRun.total_employees === null || currentRun.total_employees === undefined
          ? null
          : Number(currentRun.total_employees),
        attendanceLocked: Boolean(currentRun.attendance_snapshot_locked),
        tdsMode: currentRun.tds_mode,
        createdAt: currentRun.created_at,
        closedAt: currentRun.auto_closed_at,
      } : null,
      salaryBill: salaryBill ? {
        employeeCount: Number(salaryBill.emp_count ?? 0),
        totalGross,
        totalNet,
        totalDeductions: Number(salaryBill.total_deductions ?? 0),
      } : null,
      dataIntegrity,
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

router.get("/:dashboardCode/summary", h(async (req: AuthenticatedRequest, res: any) => {
  const dashboardCode = req.params.dashboardCode as DashboardCode;
  const { user, context, scope } = await requestedScope(req);
  // Unions work_item with work_inbox_item. Reading work_item alone showed an empty
  // inbox on all 12 dashboards while 65k live rows sat in the other table.
  const workItems = await getUnifiedInboxSummary(user.id, context.roleKeys);

  const generatedAt = new Date();
  const data = dashboardSummarySchema.parse({
    dashboardCode,
    scope,
    workItems,
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
  // Reads the union, not work_item alone. Splitting on `overdue` alone put every
  // work_inbox_item row in "good" regardless of urgency, because that table has no
  // due date — an urgent SLA breach is a bad signal whether or not a deadline exists.
  const inbox = await getUnifiedInboxSummary(req.authUser!.id, context.roleKeys);
  const isBad = (row: { priority: string }) =>
    row.priority === "urgent" || row.priority === "critical" || row.priority === "high";
  const bad = inbox.by_type.filter(isBad);
  const good = inbox.by_type.filter((row) => !isBad(row));
  const total = (rows: typeof inbox.by_type) => rows.reduce((sum, row) => sum + row.count, 0);
  return res.json({
    success: true,
    data: {
      good: { count: total(good), items: good },
      bad: { count: total(bad), items: bad },
      overdueCount: inbox.overdue_count,
      agedCount: inbox.aged_count,
      bySource: inbox.by_source,
    },
  });
}));

router.get("/:dashboardCode/metric/:metricCode/drilldown", h(async (req: AuthenticatedRequest, res: any) => {
  const dashboardCode = req.params.dashboardCode as DashboardCode;
  requireDashboardMetric(dashboardCode, req.params.metricCode);
  const { scope } = await requestedScope(req);
  const result = await getDrilldown(req.params.metricCode, scope, req.query as Record<string, unknown>);
  return res.json({ success: true, data: result });
}));

router.get("/:dashboardCode/metric/:metricCode/trend", h(async (req: AuthenticatedRequest, res: any) => {
  const dashboardCode = req.params.dashboardCode as DashboardCode;
  requireDashboardMetric(dashboardCode, req.params.metricCode);
  const { scope } = await requestedScope(req);

  // dashboard_metric_snapshot stores (metric_code, scope_type, scope_id, snapshot_date,
  // value, previous_value, trend). The previous query selected `metric_value` and
  // `metric_status` and filtered on `dashboard_code`, `role_code`, `branch_id` and
  // `process_id` — six columns the table has never had — so this endpoint returned
  // HTTP 500 for every metric on every dashboard rather than an empty series.
  const scopeParts: string[] = [];
  const scopeParams: unknown[] = [];
  if (scope.level === "BRANCH_ALL" && scope.branchIds.length > 0) {
    scopeParts.push(`scope_type = 'BRANCH'`, `scope_id IN (${scope.branchIds.map(() => "?").join(",")})`);
    scopeParams.push(...scope.branchIds);
  } else if (scope.level === "PROCESS_ALL" && scope.processIds.length > 0) {
    scopeParts.push(`scope_type = 'PROCESS'`, `scope_id IN (${scope.processIds.map(() => "?").join(",")})`);
    scopeParams.push(...scope.processIds);
  } else if (scope.level === "ORG_ALL") {
    scopeParts.push(`scope_type = 'ORG'`);
  } else {
    // A scope this table cannot express (TEAM_ONLY, SELF_ONLY, CUSTOM) must return
    // nothing rather than fall through to org-wide history.
    scopeParts.push("1 = 0");
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT snapshot_date AS snapshotDate, value, previous_value AS previousValue, trend
       FROM dashboard_metric_snapshot
      WHERE metric_code = ?
        AND snapshot_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        AND ${scopeParts.join(" AND ")}
      ORDER BY snapshot_date ASC`,
    [req.params.metricCode, ...scopeParams],
  );

  return res.json({
    success: true,
    data: {
      metricCode: req.params.metricCode,
      dashboardCode: req.params.dashboardCode,
      points: rows,
      periodDays: 30,
      // The snapshot table is never written to — no job populates it — so an empty
      // series here is expected until a snapshot writer exists. Stated rather than
      // rendered as a flat zero line.
      ...(rows.length === 0
        ? { unavailableSources: { trend: "No metric snapshots have been recorded yet" } }
        : {}),
    },
  });
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
  // This query shipped six columns that exist on neither table: b.bridge_status,
  // b.branch_id, b.process_id, b.updated_at, c.first_name and c.last_name. It threw
  // ER_BAD_FIELD_ERROR on every call, so the root-cause panel was empty on all 12
  // dashboards. Real names: ats_onboarding_bridge.status (no updated_at — bridge_date
  // and created_at are the only dates) and ats_candidate.full_name.
  //
  // The bridge has no branch/process columns either, so scope routes through
  // ats_candidate.applied_for_branch / applied_for_process, which hold NAMES and must
  // be joined to the masters by name — the same route the ONBOARDING metric uses.
  // 259 of 266 open rows resolve a branch this way; 148 resolve a process.
  const scoped = buildScopeWhere(scope, "bm.id", "pm.id");
  const [onboarding] = await db.execute<RowDataPacket[]>(
    `SELECT b.id AS entityId,
            c.full_name AS label,
            b.status AS detail,
            DATEDIFF(CURDATE(), COALESCE(b.bridge_date, DATE(b.created_at))) AS ageDays
       FROM ats_onboarding_bridge b
       LEFT JOIN ats_candidate c ON c.id = b.candidate_id
       LEFT JOIN branch_master bm ON bm.branch_name = c.applied_for_branch
       LEFT JOIN process_master pm ON pm.process_name = c.applied_for_process
      WHERE b.status IN ('pending', 'in_progress', 'stuck', 'initiated')
        AND COALESCE(b.bridge_date, DATE(b.created_at)) < DATE_SUB(CURDATE(), INTERVAL 3 DAY)
        AND ${scoped.sql}
      ORDER BY COALESCE(b.bridge_date, DATE(b.created_at)) ASC
      LIMIT 5`,
    scoped.params,
  );
  return res.json({
    success: true,
    data: {
      rootCauses: (onboarding as any[]).map((row) => ({
        domain: "ONBOARDING",
        label: row.label ?? "Unnamed candidate",
        entityId: row.entityId,
        count: 1,
        severity: Number(row.ageDays) >= 14 ? "critical" : "warn",
        detail: `${row.detail} for ${Number(row.ageDays)} days`,
        drilldownUrl: `/ats/onboarding-bridge?id=${row.entityId}`,
      })),
      generatedAt: new Date().toISOString(),
    },
  });
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
  // work_inbox_item is addressed per-user, not per-role, so it cannot be grouped by
  // assigned_to_role above. The viewer's own open items are attributed to their primary
  // role here rather than left out, which is what made this panel read as all-clear.
  const [inboxOwn] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN is_actioned = 0 THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN is_actioned = 1 THEN 1 ELSE 0 END) AS completed
       FROM work_inbox_item WHERE user_id = ?`,
    [req.authUser!.id],
  );

  const accountability = (rows as any[]).map((row) => ({
    ...row,
    total: Number(row.total),
    pending: Number(row.pending),
    overdue: Number(row.overdue),
    completed: Number(row.completed),
    completionRate: Number(row.total) > 0 ? Math.round(Number(row.completed) / Number(row.total) * 100) : 0,
  }));

  const own = (inboxOwn as RowDataPacket[])[0];
  if (own && Number(own.total) > 0) {
    const existing = accountability.find((row) => row.role === context.primaryRole);
    const total = Number(own.total);
    const pending = Number(own.pending);
    const completed = Number(own.completed);
    if (existing) {
      existing.total += total;
      existing.pending += pending;
      existing.completed += completed;
      existing.completionRate = existing.total > 0 ? Math.round(existing.completed / existing.total * 100) : 0;
    } else {
      accountability.push({
        role: context.primaryRole,
        total, pending, completed,
        // No due date exists on work_inbox_item, so overdue stays 0 rather than
        // being inferred from age.
        overdue: 0,
        completionRate: total > 0 ? Math.round(completed / total * 100) : 0,
      });
    }
    accountability.sort((a, b) => b.overdue - a.overdue || b.pending - a.pending);
  }

  return res.json({ success: true, data: { accountability, generatedAt: new Date().toISOString() } });
}));

export { router as dashboardRouter };
