import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import {
  buildScopeWhere,
  narrowDashboardScope,
  resolveDashboardScope,
  resolveSelfOnlyDashboardScope,
  type DashboardScope,
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
import { cacheInstance as dashboardMetricsCache } from "../../lib/cache/quality-cache.js";
import { logSourceFailure } from "../../shared/apiResponse.js";
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
  // Demo-bypass identities (INTERNAL_DEMO_BYPASS) have no backing row in user_roles,
  // user_assignment_scope, auth_user or employees — getUserRoleContext's DB-driven lookup
  // always misses for them and falls back to ["employee"], regardless of which demo role
  // actually logged in. Confirmed live 2026-08-06: after fixing the super_admin demo
  // token's own 401 mismatch, the account still got 403 "Not entitled to
  // SUPER_ADMIN_DASHBOARD" for exactly this reason. requireAuth already sets
  // req.authUser.role from the demo token map, so trusting it here for demo sessions is
  // safe. Deliberately local to this one entitlement check — it does not touch
  // getUserRoleContext/resolveDashboardScope, which 30+ other call sites depend on,
  // including v2 quality/operations dashboards with their own deliberately fail-closed
  // behavior for unconfigured accounts (tests/dashboards-v2.routes.test.ts); demo accounts
  // remain "unconfigured" there on purpose until that is a considered product decision.
  const roleKeys = req.authUser!.isDemo && req.authUser!.role
    ? [req.authUser!.role]
    : (await getUserRoleContext(req.authUser!.id)).roleKeys;
  if (!canAccessDashboard(definition.code, roleKeys)) {
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

async function requestedScope(req: AuthenticatedRequest, dashboardCode?: DashboardCode) {
  const user = req.authUser!;

  // EMPLOYEE_SELF_DASHBOARD is a personal view — scope is always "this one caller", never
  // a function of their role. Every other branch below resolves scope from the caller's
  // ROLE (resolveDashboardScope / the demo ORG_ALL bypass), which is correct for an
  // operational dashboard shared across a team but wrong here: it previously gave a
  // branch_head's own "My Dashboard" the identical BRANCH_ALL scope HR_DASHBOARD shows
  // them. See resolveSelfOnlyDashboardScope's own comment for the full history.
  if (dashboardCode === "EMPLOYEE_SELF_DASHBOARD") {
    const context = await getUserRoleContext(user.id);
    const scope = await narrowDashboardScope(
      await resolveSelfOnlyDashboardScope(user.id),
      String(req.query.branchId ?? ""),
      String(req.query.processId ?? ""),
    );
    return { user, context, scope };
  }

  // Demo-bypass identities (INTERNAL_DEMO_BYPASS) have no backing row in any MySQL table, so
  // resolveDashboardScope's own internal getUserRoleContext(userId) call always misses and
  // falls back to role "employee" for them — which then fails closed with 409 "No active
  // employee mapping scope is configured for role employee" instead of rendering real
  // demo data. Confirmed live 2026-08-06, right after fixing the entitlement-gate 403 above.
  //
  // For the two roles resolveDashboardScope itself already treats as unconditionally
  // org-wide ("super_admin", "admin" — its own SYSTEM_WIDE_ROLES set), constructing that
  // same ORG_ALL scope directly here for demo sessions matches its existing, deliberate
  // logic exactly. Deliberately narrow: it does not call resolveDashboardScope or touch
  // roleResolver.ts, so every other role (including demo hr/wfm/team_leader/etc., which
  // genuinely have no real branch/process to show and are left exactly as before) and the
  // v2 quality/operations dashboards' own separate, deliberately fail-closed "unconfigured
  // account" contract (tests/dashboards-v2.routes.test.ts) are completely unaffected.
  const isDemoSystemWide = user.isDemo === true && (user.role === "super_admin" || user.role === "admin");

  const context = isDemoSystemWide
    ? { roleKeys: [user.role!], primaryRole: user.role!, isSuperAdmin: true, isHO: false }
    : await getUserRoleContext(user.id);

  const base: DashboardScope = isDemoSystemWide
    ? { level: "ORG_ALL", branchIds: [], processIds: [], employeeIds: [], userId: user.id, role: context.primaryRole }
    : await resolveDashboardScope(user.id, context.primaryRole);

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

  // salaryBill, unpaidActive and zeroAttendanceRisk are mutually independent —
  // none reads another's result, only currentRun (already resolved above) and
  // salaryScope. Previously three sequential awaits; against the live DB this
  // measured ~28.7s for the endpoint. Kicked off together below; each keeps
  // its own failure handling exactly as before (zeroAttendanceRisk's
  // try/catch, in particular, is preserved verbatim — see the comment on it).
  const salaryBillPromise = db.execute<RowDataPacket[]>(
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
  //
  // The inner `agg` subquery aggregated ALL of salary_prep_line_component with no
  // filter — every line of every run — before joining down to this one run's lines.
  // Measured ~23.6s standalone against the live DB (this table backs every payroll
  // run ever calculated). Scoped it to this run's line_ids the same way the join
  // already implies, cutting it to ~5.7s with an identical result, verified against
  // production. Still worth a covering index later; tracked separately since that
  // needs a migration, not a query change.
  const unpaidActivePromise = db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS unpaid_lines,
            COALESCE(ROUND(SUM(agg.earn), 2), 0) AS earnings_recorded
       FROM salary_prep_line l
       JOIN employees e ON e.id = l.employee_id
       JOIN (SELECT line_id,
                    SUM(CASE WHEN component_type = 'earning' THEN amount ELSE 0 END) AS earn
               FROM salary_prep_line_component
              WHERE line_id IN (SELECT id FROM salary_prep_line WHERE run_id = ?)
              GROUP BY line_id) agg ON agg.line_id = l.id
      WHERE l.run_id = ?
        AND l.net_salary = 0
        AND agg.earn > 0
        AND e.active_status = 1
        AND ${salaryScope.sql}`,
    [currentRun.id, currentRun.id, ...salaryScope.params],
  ).then(([rows]) => (rows as any[])[0] ?? null);

  // Forward-looking companion to the check below: employees who WOULD be zeroed by the next
  // ADR-sourced run, before it is calculated.
  //
  // Traced from six employees (58150C, 59513C, 60021C, 60129C, 61297C, 61444C) who are paid
  // whenever a run uses the legacy attendance path and paid nothing whenever it uses ADR.
  // Their ADR rows hold only 'absent' and 'missing_punch' — never a present day — so the
  // ADR path has nothing to pay them for. That is not specific to those six: it zeroes any
  // payable employee whose attendance is not reaching ADR, and it does so silently.
  //
  // Restricted to ACTIVE branches on purpose. Most of the affected population sits at
  // branches that are closed (Delhi Office, KARNAL, MOHALI, HYDERABAD, JAIPUR), where an
  // employee still flagged active is a records-hygiene question rather than a payroll one.
  // Counting those would bury the handful that would actually be mispaid.
  //
  // The failure is logged and surfaced in dataIntegrity rather than defaulted to zero.
  // Defaulting would report "nobody at risk" — the most reassuring possible answer, and
  // indistinguishable from a genuine zero — so an unanswered question would read as a clean
  // bill of health. payroll-run-selection-contract.test.ts enforces this for the whole
  // route by string search, which is also why the forbidden pattern is not quoted here.
  const zeroAttendanceRiskPromise: Promise<number | null> = (async () => {
    try {
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS at_risk
           FROM employees e
           JOIN employee_salary_assignment esa
             ON esa.employee_id = e.id AND esa.active_status = 1
           JOIN branch_master b ON b.id = e.branch_id AND b.active_status = 1
          WHERE LOWER(e.employment_status) = 'active'
            AND NOT EXISTS (
                  SELECT 1 FROM attendance_daily_record a
                   WHERE a.employee_id = e.id
                     AND a.record_date >= DATE_SUB(CURDATE(), INTERVAL 60 DAY)
                     AND a.attendance_status IN ('present', 'week_off_worked', 'half_day'))
            AND ${salaryScope.sql}`,
        [...salaryScope.params],
      );
      return Number((rows as RowDataPacket[])[0]?.at_risk ?? 0);
    } catch (err) {
      logSourceFailure("dashboard.payroll-zero-attendance-risk", err, { runId: currentRun.id });
      return null;
    }
  })();

  const [salaryBill, unpaidActive, zeroAttendanceRisk] = await Promise.all([
    salaryBillPromise,
    unpaidActivePromise,
    zeroAttendanceRiskPromise,
  ]);

  // The run has no stored label; compose a stable one so the existing `currentRun.label`
  // contract on the frontend keeps working.
  const runLabel = [currentRun.run_month, currentRun.branch_filter].filter(Boolean).join(" · ");

  const totalGross = Number(salaryBill?.total_gross ?? 0);
  const totalNet = Number(salaryBill?.total_net ?? 0);

  const dataIntegrity: string[] = [];

  if (zeroAttendanceRisk === null) {
    dataIntegrity.push(
      "Could not determine how many payable employees have no attendance marked present. " +
        "Treat this check as unanswered rather than clear.",
    );
  } else if (zeroAttendanceRisk > 0) {
    dataIntegrity.push(
      `${zeroAttendanceRisk} payable employee(s) at active branches have no attendance ` +
        `marked present in the last 60 days. An ADR-sourced run pays them zero, which is ` +
        `indistinguishable from a genuine nil payment — confirm their attendance is ` +
        `reaching the system before calculating.`,
    );
  }

  const unpaidLines = Number(unpaidActive?.unpaid_lines ?? 0);
  if (unpaidLines > 0) {
    dataIntegrity.push(
      `${unpaidLines} active employee(s) in this run have earning components totalling ` +
        `${unpaidActive.earnings_recorded} but a net pay of zero. Most have no attendance ` +
        `record for the period, so this is likely the attendance-exception backlog ` +
        `reaching payroll — check the attendance exceptions panel before approving.`,
    );
  }

  // Four of the six panels declared "unavailable" below actually have data; the
  // layout was reading keys nothing ever returned, so they rendered empty forever.
  //
  //   disbursement      payroll_disbursement HAS a run_id column — it is run-linked,
  //                     and the note claiming otherwise was simply wrong. 12 runs
  //                     carry real NEFT references and amounts.
  //   branchReadiness   payroll_branch_readiness.process_month matches run_month.
  //                     The join needs an explicit COLLATE: the two columns carry
  //                     different collations and MySQL raises
  //                     ER_CANT_AGGREGATE_2COLLATIONS rather than comparing them.
  //   loans /           org-wide aggregates, genuinely not run-scoped. Shown as
  //   reimbursements    current position rather than pretending they belong to a run.
  //
  // Each is independently caught: one missing panel must not blank the others, and
  // null renders as unavailable rather than as a zero.
  const panel = async <T,>(key: string, fn: () => Promise<T>): Promise<T | null> => {
    try { return await fn(); }
    catch (err) { logSourceFailure(`dashboard.payroll-${key}`, err, { runId: currentRun?.id }); return null; }
  };

  const disbursement = currentRun ? await panel("disbursement", async () => {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT status, total_amount, employee_count, bank_ref, disbursed_at
         FROM payroll_disbursement WHERE run_id = ? ORDER BY disbursed_at DESC LIMIT 1`,
      [currentRun.id],
    );
    const d = rows[0];
    return d ? {
      status: d.status ?? null,
      totalAmount: d.total_amount === null ? null : Number(d.total_amount),
      employeeCount: d.employee_count === null ? null : Number(d.employee_count),
      bankRef: d.bank_ref ?? null,
      disbursedAt: d.disbursed_at ?? null,
    } : null;
  }) : null;

  const branchReadiness = currentRun ? await panel("branch-readiness", async () => {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS branches,
              SUM(attendance_frozen = 1) AS attendanceFrozen,
              SUM(attendance_data_ready = 1) AS dataReady
         FROM payroll_branch_readiness
        WHERE process_month COLLATE utf8mb4_unicode_ci = ? COLLATE utf8mb4_unicode_ci`,
      [currentRun.run_month],
    );
    const r = rows[0];
    return Number(r?.branches ?? 0) === 0 ? null : {
      branches: Number(r.branches),
      attendanceFrozen: Number(r.attendanceFrozen ?? 0),
      dataReady: Number(r.dataReady ?? 0),
    };
  }) : null;

  // salary_payslip is keyed by run_month (no run_id), so generation is counted for
  // the run's month against the lines in the run. This is what the "Payslip
  // Generation Status" panel was trying to show with a `disbursement` breakdown
  // that the endpoint never returned.
  const payslips = currentRun ? await panel("payslips", async () => {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         (SELECT COUNT(*) FROM salary_payslip
           WHERE run_month COLLATE utf8mb4_unicode_ci = ? COLLATE utf8mb4_unicode_ci) AS \`generated\`,
         (SELECT COUNT(*) FROM salary_prep_line WHERE run_id = ?) AS expected`,
      [currentRun.run_month, currentRun.id],
    );
    const r = rows[0];
    const expected = Number(r?.expected ?? 0);
    if (expected === 0) return null;
    const generated = Number(r?.generated ?? 0);
    return {
      generated,
      expected,
      pending: Math.max(0, expected - generated),
      pct: Math.round((generated / expected) * 1000) / 10,
    };
  }) : null;

  // Loans and reimbursements are deliberately NOT queried here.
  //
  // employee_loans (67 rows) and reimbursement_claim both hold real data, and it is
  // tempting to fill those two empty panels with it. But this endpoint is scoped to
  // one payroll run, and neither table is run-scoped — surfacing an org-wide total
  // beside run figures invites it to be read as belonging to the run.
  //
  // payroll-run-selection-contract.test.ts asserts the loan table is never selected
  // from in this route for exactly that reason. (It matches on the literal SQL, so
  // this note deliberately avoids spelling the phrase out.) That constraint is
  // intentional and left intact; both stay in unavailableSources with a real reason.
  // If those panels are wanted, they belong on a month- or org-scoped endpoint.

  return res.json({
    success: true,
    data: {
      currentMonth,
      disbursement,
      branchReadiness,
      payslips,
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
      // Only what is genuinely unavailable. This used to list six sources
      // unconditionally, including four that do have data — so the "Run-linked
      // Source Availability" panel rendered the same six explanations on every
      // load forever while the panels above it sat empty.
      //
      // Each entry is now conditional, so the panel shrinks as sources come back
      // and disappears entirely once nothing is missing.
      unavailableSources: {
        // statutory_filing_record does not exist in the database at all.
        statutoryFiling: "No statutory filing records are stored yet",
        pendingQueues: "Queue records are not linked to a payroll run",
        ...(disbursement ? {} : { disbursement: "No disbursement recorded for this run" }),
        ...(payslips ? {} : { payslips: "No payroll lines in this run to generate payslips for" }),
        ...(branchReadiness ? {} : { branchReadiness: `No branch readiness recorded for ${currentRun?.run_month ?? "this month"}` }),
        loans: "Loan balances are org-wide, not scoped to a payroll run",
        reimbursements: "Reimbursement claims are org-wide, not scoped to a payroll run",
      },
      generatedAt: new Date().toISOString(),
    },
  });
}));

router.get("/:dashboardCode/summary", h(async (req: AuthenticatedRequest, res: any) => {
  const dashboardCode = req.params.dashboardCode as DashboardCode;
  const { user, context, scope } = await requestedScope(req, dashboardCode);
  const generatedAt = new Date();

  // Unions work_item with work_inbox_item. Reading work_item alone showed an empty
  // inbox on all 12 dashboards while 65k live rows sat in the other table.
  //
  // Isolate the inbox from the metrics: a failure here must not 500 the whole
  // summary and render every metric tile as an em-dash. CEO UAT 31-Jul-2026
  // reported exactly that on /ceo/dashboard — nine hollow tiles and four
  // "unavailable" panels from one failing aggregation. On failure `workItems`
  // is OMITTED, never zeroed: a fabricated "0 pending / 0 overdue" reads as an
  // empty inbox and would hide the outage, which
  // dashboard-error-semantics.test.ts explicitly forbids. `workItemsStatus` is
  // what tells the client the difference between "empty" and "unknown".
  //
  // workItems and the dashboard metrics are fully independent aggregations —
  // this used to be `await`ed before executeDashboardMetrics even started,
  // serially adding its own latency (~1-2s measured against the live DB) on
  // top of every dashboard load, all 12 of them. Running both concurrently
  // removes that entirely; each keeps exactly the failure isolation above.
  const workItemsPromise = (async (): Promise<{
    workItems: Awaited<ReturnType<typeof getUnifiedInboxSummary>> | undefined;
    workItemsStatus: "ok" | "unavailable";
  }> => {
    try {
      return { workItems: await getUnifiedInboxSummary(user.id, context.roleKeys), workItemsStatus: "ok" };
    } catch (err: unknown) {
      console.error("[dashboards/summary] work-item aggregation failed", err instanceof Error ? err.message : err);
      return { workItems: undefined, workItemsStatus: "unavailable" };
    }
  })();

  // Metrics are org/branch/process-scoped aggregates, not per-user data — every
  // viewer of the same scope (e.g. 20 people with the org-wide CEO dashboard
  // open) was independently re-running the same ~4-6s of queries against a DB
  // that is ~160ms away over the network. A short TTL cache means only the
  // first request in the window pays that cost; everyone else within 30s gets
  // the same real numbers instantly. workItems is deliberately NOT cached here
  // — it is per-user (assigned_to_user_id = this viewer), so caching it under
  // a scope-only key would leak one user's pending items to another.
  // OPEN QUESTION (not yet confirmed by dashboard owners): 30s is my own pick
  // for "reasonable staleness" for aggregate tiles, not a stated requirement.
  // Ask per-dashboard whether that window is acceptable, same question as the
  // pnl cache below (see canonical-pnl.service.ts) but lower stakes here since
  // these are operational aggregates, not the P&L figures shown to finance/CEO.
  const metricsCacheKey = `dash-metrics:v1:${dashboardCode}:${scope.level}:${scope.branchIds.join(",")}:${scope.processIds.join(",")}:${scope.employeeIds.join(",")}`;
  const metricsPromise = dashboardMetricsCache.getOrSet(
    metricsCacheKey,
    () => executeDashboardMetrics(dashboardCode, scope, generatedAt) as Promise<Record<string, unknown>>,
    30,
  );

  const [{ workItems, workItemsStatus }, metrics] = await Promise.all([
    workItemsPromise,
    metricsPromise,
  ]);

  const data = dashboardSummarySchema.parse({
    dashboardCode,
    scope,
    workItems,
    workItemsStatus,
    metrics,
    generatedAt: generatedAt.toISOString(),
  });
  return res.json({ success: true, data });
}));

router.get("/:dashboardCode/metric-values", h(async (req: AuthenticatedRequest, res: any) => {
  const dashboardCode = req.params.dashboardCode as DashboardCode;
  const { scope } = await requestedScope(req, dashboardCode);
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
  const { scope } = await requestedScope(req, dashboardCode);
  const result = await getDrilldown(req.params.metricCode, scope, req.query as Record<string, unknown>);
  return res.json({ success: true, data: result });
}));

router.get("/:dashboardCode/metric/:metricCode/trend", h(async (req: AuthenticatedRequest, res: any) => {
  const dashboardCode = req.params.dashboardCode as DashboardCode;
  requireDashboardMetric(dashboardCode, req.params.metricCode);
  const { scope } = await requestedScope(req, dashboardCode);

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
  const dashboardCode = req.params.dashboardCode as DashboardCode;
  const { scope } = await requestedScope(req, dashboardCode);
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
  const dashboardCode = req.params.dashboardCode as DashboardCode;
  const { scope } = await requestedScope(req, dashboardCode);
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
