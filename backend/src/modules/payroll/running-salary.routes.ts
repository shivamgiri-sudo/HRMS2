/**
 * Running (live/daily) salary estimate routes.
 * Provides daily earned salary and end-of-month projection per employee.
 * Used by management for business insights — no payroll finalization involved.
 *
 * Source-of-truth rule:
 *   locked / approved / disbursed run exists for the month → return stored line figures
 *   draft / processing run OR no run at all → return live computed estimate
 */

import { Router } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { hasAnyRole, buildScopeWhereClause } from "../../shared/scopeAccess.js";
import { computeRunningSalary } from "./running-salary.service.js";
import { toISTDate } from "../../shared/timezone.js";
import type { RowDataPacket } from "mysql2/promise";
import type { Response } from "express";

export const runningSalaryRouter = Router();

/**
 * Roles whose reach is limited to their assigned scope.
 *
 * Deliberately excludes admin / super_admin / ceo — those bypass through
 * allowAdminBypass / allowCeoAllRead / the super_admin short-circuit inside
 * buildScopeWhereClause, exactly as PAYROLL_SCOPE_ROLES does in payroll.routes.ts.
 * A role listed here needs a user_assignment_scope row; scope_type='all' is how an
 * HO user keeps org-wide reach.
 */
const RUNNING_SALARY_SCOPE_ROLES = [
  "payroll_head", "payroll_branch", "payroll", "payroll_admin",
  "hr", "hr_admin", "wfm", "branch_head", "management",
];

/**
 * Every scope type the employees table can satisfy. All five are supplied because
 * buildScopeWhereClause silently skips a scope whose alias is missing — a
 * department-scoped user with only `branchId` mapped would fall through to 1=0 and
 * be denied their own department. Same alias map as attendance.dispute.routes.ts.
 */
const EMPLOYEE_SCOPE_ALIASES = {
  branchId: "e.branch_id",
  processId: "e.process_id",
  departmentId: "e.department_id",
  managerEmployeeId: "e.reporting_manager_id",
  employeeId: "e.id",
};

/**
 * Current payroll month (YYYY-MM) in IST.
 *
 * Payroll months are IST months. `new Date().getFullYear()/getMonth()` reads the
 * *server's* local clock — on a UTC host that resolves to the previous day
 * between 00:00 and 05:30 IST, and therefore to the previous *month* during that
 * window on the 1st. That silently returned last month's running salary.
 */
function currentIstRunMonth(): string {
  return (toISTDate(new Date()) ?? new Date().toISOString().slice(0, 10)).slice(0, 7);
}

/**
 * Resolve the payroll month to show when none is explicitly requested.
 *
 * On the 1st–3rd of a new month the current calendar month has no payroll run
 * and no attendance data yet — showing it produces earned_salary = ₹0, which
 * looks like a bug to every HR user checking yesterday's salary. Fall back to
 * the previous month when:
 *   • today is the 1st–3rd of the month (early rollover window), AND
 *   • the current month has no active salary_prep_run row.
 * Outside that window, or once a run is created, the current month is returned.
 */
async function resolveDefaultRunMonth(db: typeof import("../../db/mysql.js").db): Promise<string> {
  const currentMonth = currentIstRunMonth();
  const todayIst = (toISTDate(new Date()) ?? new Date().toISOString().slice(0, 10));
  const dayOfMonth = parseInt(todayIst.slice(8, 10), 10);

  // Only look back during the early rollover window (days 1–3)
  if (dayOfMonth > 3) return currentMonth;

  const [rows] = await db.execute<import("mysql2/promise").RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt FROM salary_prep_run WHERE run_month = ?`,
    [currentMonth],
  );
  const hasCurrent = Number((rows[0] as any).cnt ?? 0) > 0;
  if (hasCurrent) return currentMonth;

  // No run yet this month — return the previous month
  const [y, m] = currentMonth.split("-").map(Number);
  const prevM = m === 1 ? 12 : m - 1;
  const prevY = m === 1 ? y - 1 : y;
  return `${prevY}-${String(prevM).padStart(2, "0")}`;
}


// ─── Shared helper ────────────────────────────────────────────────────────────

/**
 * Check whether a finalized (locked/approved/disbursed) salary_prep_line exists
 * for this employee in the given month. If yes, return its key figures so the
 * caller can surface the authoritative stored amount instead of a live estimate.
 * Returns null when no finalized line exists (draft run or no run at all).
 */
async function getFinalizedLineForMonth(
  employeeId: string,
  runMonthYYYYMM: string, // "YYYY-MM"
): Promise<{
  run_status: string;
  run_month: string;
  gross_salary: number;
  total_deductions: number;
  net_salary: number;
  basic: number;
  hra: number;
  special_allowance: number;
  pf_employee: number;
  esic_employee: number;
  professional_tax: number;
  tds: number;
  final_payable_days: number;
  paid_working_days: number;
  eligible_weekoff_days: number;
  eligible_holiday_days: number;
  active_calendar_days: number;
  lwp_days: number;
  present_days: number;
  is_finalized: boolean;
  /** true when the run is still in draft/processing — figures are calculated but not yet locked */
  is_draft: boolean;
  // Live-estimate field aliases — keeps all frontend consumers consistent
  earned_salary_till_date: number;
  earned_net_till_date: number;
  earned_payable_days: number;
  eligible_weekoff_till_date: number;
  eligible_holiday_till_date: number;
  lwp_till_date: number;
  projected_salary: number;
  projected_net: number;
  projected_payable_days: number;
  gross_monthly: number;
  esic_applicable: boolean;
  // APR provenance, always inert here — see the note at the return below.
  apr_eligible: boolean;
  apr_verified_payable_days: number | null;
  apr_verified_salary_till_date: number | null;
  fallback_payable_days: number | null;
  fallback_salary_till_date: number | null;
  apr_no_data_days: number | null;
} | null> {
  const { db } = await import("../../db/mysql.js");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT spl.gross_salary, spl.total_deductions, spl.net_salary,
            spl.basic, spl.hra, spl.special_allowance,
            spl.pf_employee, spl.esic_employee, spl.professional_tax, spl.tds,
            spl.final_payable_days, spl.paid_working_days,
            spl.eligible_weekoff_days, spl.eligible_holiday_days,
            spl.active_calendar_days, spl.lwp_days, spl.present_days,
            spr.status AS run_status, spr.run_month
       FROM salary_prep_line spl
       JOIN salary_prep_run spr ON spr.id = spl.run_id
      WHERE spl.employee_id = ?
        AND spr.run_month = ?
        -- Include draft/processing runs so the running-summary returns the stored
        -- calculated figures as soon as payroll has run — not a live re-estimate
        -- that will differ from what the payslip page shows. The is_draft flag in
        -- the response lets the frontend label it "Draft" rather than "Live estimate".
        AND spr.status IN ('locked', 'approved', 'disbursed', 'completed', 'finalized',
                           'draft', 'processing', 'calculating', 'calculated')
        AND spl.status NOT IN ('excluded', 'blocked')
      ORDER BY
        -- Most authoritative first. Finalized/disbursed outrank draft so a
        -- re-run that produces a second line for the same month uses the settled one.
        CASE spr.status
          WHEN 'disbursed'   THEN 1
          WHEN 'finalized'   THEN 2
          WHEN 'locked'      THEN 3
          WHEN 'approved'    THEN 4
          WHEN 'completed'   THEN 5
          WHEN 'calculated'  THEN 6
          WHEN 'processing'  THEN 7
          WHEN 'calculating' THEN 8
          WHEN 'draft'       THEN 9
          ELSE 10
        END
      LIMIT 1`,
    [employeeId, runMonthYYYYMM],
  );
  const row = (rows as any[])[0];
  if (!row) return null;
  const grossSalary   = Number(row.gross_salary   ?? 0);
  const netSalary     = Number(row.net_salary     ?? 0);
  const payableDays   = Number(row.final_payable_days ?? 0);
  const weekoffDays   = Number(row.eligible_weekoff_days ?? 0);
  const holidayDays   = Number(row.eligible_holiday_days ?? 0);
  const lwpDays       = Number(row.lwp_days       ?? 0);
  const runStatus     = String(row.run_status ?? "");
  const CLOSED_STATUSES = new Set(["disbursed", "finalized", "locked", "approved", "completed"]);
  return {
    run_status:           runStatus,
    run_month:            String(row.run_month),
    gross_salary:         grossSalary,
    total_deductions:     Number(row.total_deductions ?? 0),
    net_salary:           netSalary,
    basic:                Number(row.basic ?? 0),
    hra:                  Number(row.hra ?? 0),
    special_allowance:    Number(row.special_allowance ?? 0),
    pf_employee:          Number(row.pf_employee ?? 0),
    esic_employee:        Number(row.esic_employee ?? 0),
    professional_tax:     Number(row.professional_tax ?? 0),
    tds:                  Number(row.tds ?? 0),
    final_payable_days:   payableDays,
    paid_working_days:    Number(row.paid_working_days ?? 0),
    eligible_weekoff_days: weekoffDays,
    eligible_holiday_days: holidayDays,
    active_calendar_days: Number(row.active_calendar_days ?? 0),
    lwp_days:             lwpDays,
    present_days:         Number(row.present_days ?? 0),
    is_finalized:         CLOSED_STATUSES.has(runStatus.toLowerCase()),
    is_draft:             !CLOSED_STATUSES.has(runStatus.toLowerCase()),
    // Aliases matching the live-estimate field names so every frontend consumer
    // (SalaryTab, RunningPayrollBreakdown, PayslipViewer) works identically
    // whether the month is finalized or still in progress.
    earned_salary_till_date:    grossSalary,
    earned_net_till_date:       netSalary,
    earned_payable_days:        payableDays,
    eligible_weekoff_till_date: weekoffDays,
    eligible_holiday_till_date: holidayDays,
    lwp_till_date:              lwpDays,
    projected_salary:           grossSalary,
    projected_net:              netSalary,
    projected_payable_days:     payableDays,
    gross_monthly:              grossSalary,
    esic_applicable:            Number(row.esic_employee ?? 0) > 0,
    // A finalized month is never gated on APR provenance. The money is already
    // decided and, once locked, paid — telling the viewer it is "not APR-verified"
    // would question a settled figure it can no longer change. The live estimate
    // path is where the distinction is actionable.
    apr_eligible:                 false,
    apr_verified_payable_days:    null,
    apr_verified_salary_till_date: null,
    fallback_payable_days:        null,
    fallback_salary_till_date:    null,
    apr_no_data_days:             null,
  };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/payroll/running-summary/me?month=YYYY-MM
 * Employee self-service: returns finalized line if the run is locked/approved/disbursed,
 * otherwise returns live running salary estimate.
 * Registered before /:employeeId so the literal "me" is not captured as a param.
 */
runningSalaryRouter.get(
  "/running-summary/me",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.authUser!.id;

    const { db } = await import("../../db/mysql.js");

    const [empRows] = await (db as any).execute(
      "SELECT id FROM employees WHERE auth_user_id = ? AND employment_status = 'active' LIMIT 1",
      [userId]
    );
    if (!(empRows as any[]).length) {
      return res.status(404).json({ success: false, message: "No active employee record found for this user" });
    }
    const employeeId = (empRows[0] as any).id;

    const rawMonth = (req.query.month as string) || (req.query.runMonth as string) || "";
    let runMonthYYYYMM: string;
    let runMonth: string;
    if (rawMonth && /^\d{4}-\d{2}$/.test(rawMonth)) {
      runMonthYYYYMM = rawMonth;
      runMonth = `${rawMonth}-01`;
    } else {
      const { db } = await import("../../db/mysql.js");
      runMonthYYYYMM = await resolveDefaultRunMonth(db);
      runMonth = `${runMonthYYYYMM}-01`;
    }

    // Return stored finalized line when it exists — single source of truth once locked
    const finalized = await getFinalizedLineForMonth(employeeId, runMonthYYYYMM);
    if (finalized) {
      return res.json({ success: true, data: finalized, run_month: runMonth });
    }

    const asOf = req.query.as_of as string | undefined;
    try {
      const result = await computeRunningSalary(employeeId, runMonth, asOf);
      return res.json({ success: true, data: result, run_month: runMonth });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }
);

/**
 * GET /api/payroll/running-summary/:employeeId?month=YYYY-MM
 * Returns finalized line when run is locked/approved/disbursed, otherwise live estimate.
 * Accessible to payroll, HR, branch head, management, super_admin.
 */
runningSalaryRouter.get(
  "/running-summary/:employeeId",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.authUser!.id;
    // wfm and payroll_admin are included deliberately. Both pages that render the
    // running-month card — /payroll/running-breakdown and /hr/attendance-lookup —
    // already grant them, and the payroll module already authorizes them on
    // comparable data: PAYROLL_ROLES in payroll-attendance-control.service.ts
    // carries wfm, and holiday-debug.routes.ts carries both. Omitting them here
    // made this route the outlier, so those users reached the page and took a 403
    // on the one figure it exists to show. hasAnyRole matches role_key exactly —
    // there is no payroll_admin -> payroll normalisation to fall back on.
    if (
      !(await hasAnyRole(
        userId,
        "super_admin", "admin", "payroll_head", "payroll_branch", "payroll",
        "payroll_admin", "hr", "hr_admin", "wfm", "branch_head", "management"
      ))
    ) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { employeeId } = req.params;

    // Role alone answers "may you read running salary", never "whose". Without this
    // a branch_head or wfm user authorized above could read any employee in the
    // company, which is precisely the row-scope enforcement the charter requires at
    // query level rather than in the UI.
    const scoped = await buildScopeWhereClause(
      userId,
      RUNNING_SALARY_SCOPE_ROLES,
      EMPLOYEE_SCOPE_ALIASES,
      { allowAdminBypass: true, allowCeoAllRead: true },
    );
    {
      const { db } = await import("../../db/mysql.js");
      const [inScope] = await db.execute<RowDataPacket[]>(
        `SELECT 1 FROM employees e WHERE e.id = ? AND (${scoped.sql}) LIMIT 1`,
        [employeeId, ...scoped.params],
      );
      if ((inScope as RowDataPacket[]).length === 0) {
        // Distinguished from the role denial above so a user who is the right role
        // but has no user_assignment_scope row is diagnosable, not just "denied".
        return res.status(403).json({
          success: false,
          message: "Access denied: employee is outside your assigned scope",
        });
      }
    }

    const rawMonth = (req.query.month as string) || "";

    let runMonthYYYYMM: string;
    let runMonth: string;
    if (rawMonth && /^\d{4}-\d{2}$/.test(rawMonth)) {
      runMonthYYYYMM = rawMonth;
      runMonth = `${rawMonth}-01`;
    } else {
      const { db: dbInner } = await import("../../db/mysql.js");
      runMonthYYYYMM = await resolveDefaultRunMonth(dbInner);
      runMonth = `${runMonthYYYYMM}-01`;
    }

    // Return stored finalized line when it exists — single source of truth once locked
    const finalized = await getFinalizedLineForMonth(employeeId, runMonthYYYYMM);
    if (finalized) {
      return res.json({ success: true, data: finalized, run_month: runMonth });
    }

    const asOf = req.query.as_of as string | undefined;

    try {
      const result = await computeRunningSalary(employeeId, runMonth, asOf);
      return res.json({ success: true, data: result, run_month: runMonth });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }
);

/**
 * GET /api/payroll/running-summary/batch?month=YYYY-MM&branch_id=...&process_id=...&search=...&page=1&limit=50
 * Batch running summary for a branch or process — backs the Current Payroll page's live
 * salary lookup (LiveSalaryPanel/LiveSalaryTable), not just a management dashboard anymore.
 * Returns {employee_id, employee_code, name, branch_name, process_name, designation_name,
 * ...summary} plus `total` for pagination. Each employee uses finalized line if available,
 * otherwise live estimate.
 *
 * search/page were added alongside the Current Payroll UI rework — without them the caller
 * could only ever see the first 100 employees in scope with no way to find anyone by name,
 * which is exactly the gap the attendance lookup page (GET /api/employees/hr-hub) already
 * solved for attendance. Same LIKE-based approach here since this employee set (active +
 * salary-assigned) is small (~1-2k), not the 70k+ row tables the payroll records fix dealt with.
 */
runningSalaryRouter.get(
  "/running-summary-batch",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.authUser!.id;
    if (
      !(await hasAnyRole(
        userId,
        "super_admin", "admin", "payroll_head", "payroll_branch", "payroll",
        "branch_head", "management",
        // The team attendance grid shows each employee's salary days beside their
        // month, and that figure has to be the one payroll will actually pay — so it
        // comes from here, where computeRunningSalary is the single source, rather
        // than from a second formula written for the grid. Row scope is unchanged and
        // still applies below; this widens who may ask, not whose data comes back.
        "manager", "assistant_manager", "tl", "team_leader", "process_manager", "hr", "wfm",
      ))
    ) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const rawMonth = (req.query.month as string) || "";
    let runMonthYYYYMM: string;
    let runMonth: string;

    const { db } = await import("../../db/mysql.js");

    if (rawMonth && /^\d{4}-\d{2}$/.test(rawMonth)) {
      runMonthYYYYMM = rawMonth;
      runMonth = `${rawMonth}-01`;
    } else {
      runMonthYYYYMM = await resolveDefaultRunMonth(db);
      runMonth = `${runMonthYYYYMM}-01`;
    }

    const { branch_id, process_id, search } = req.query as Record<string, string>;
    const limitRaw = parseInt((req.query.limit as string) || "50", 10);
    const limit = Math.min(Math.max(1, limitRaw), 100);
    const pageRaw = parseInt((req.query.page as string) || "1", 10);
    const page = Math.max(1, Number.isFinite(pageRaw) ? pageRaw : 1);
    const offset = (page - 1) * limit;

    const conds: string[] = [
      "e.employment_status = 'active'",
      "esa.active_status = 1",
    ];
    const params: unknown[] = [];
    if (branch_id) { conds.push("e.branch_id = ?"); params.push(branch_id); }
    if (process_id) { conds.push("e.process_id = ?"); params.push(process_id); }
    if (search && search.trim()) {
      // Escape SQL LIKE wildcards, same guard payroll.service.ts's listPayrollRecords uses.
      const escaped = search.trim().replace(/[%_\\]/g, ch => "\\" + ch);
      const s = `%${escaped}%`;
      conds.push(
        "(e.employee_code LIKE ? ESCAPE '\\\\' OR e.full_name LIKE ? ESCAPE '\\\\'" +
        " OR CONCAT(COALESCE(e.first_name,''),' ',COALESCE(e.last_name,'')) LIKE ? ESCAPE '\\\\')"
      );
      params.push(s, s, s);
    }

    // branch_id / process_id above are caller-supplied filters, not permissions —
    // on their own they let a branch_head pass any branch and pull 100 employees'
    // salary from a branch they do not run. ANDed with the scope clause, an
    // out-of-scope branch simply matches no rows.
    const scoped = await buildScopeWhereClause(
      userId,
      RUNNING_SALARY_SCOPE_ROLES,
      EMPLOYEE_SCOPE_ALIASES,
      { allowAdminBypass: true, allowCeoAllRead: true },
    );
    conds.push(`(${scoped.sql})`);
    params.push(...scoped.params);

    const whereSql = conds.join(" AND ");
    const fromSql = `
       FROM employees e
       JOIN employee_salary_assignment esa ON esa.employee_id = e.id
       LEFT JOIN branch_master bm      ON bm.id = e.branch_id
       LEFT JOIN process_master pm     ON pm.id = e.process_id
       LEFT JOIN designation_master dsg ON dsg.id = e.designation_id
      WHERE ${whereSql}`;

    const [empRows] = await (db as any).execute(
      // Plain CONCAT(first_name, last_name) returns NULL the moment either half is NULL
      // (126 of 1329 in-scope employees) — with ORDER BY name ASC that pushed every
      // blank-named row to page 1, since MySQL sorts NULL first. Same COALESCE/TRIM
      // fallback chain payroll.service.ts's listPayrollRecords already uses.
      `SELECT e.id, e.employee_code,
              COALESCE(NULLIF(TRIM(e.full_name),''),
                       TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,''))),
                       e.employee_code) AS name,
              bm.branch_name, pm.process_name, dsg.designation_name
       ${fromSql}
       ORDER BY name ASC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );
    const [countRows] = await (db as any).execute(
      `SELECT COUNT(*) AS total FROM employees e
       JOIN employee_salary_assignment esa ON esa.employee_id = e.id
      WHERE ${whereSql}`,
      params
    );
    const total = Number((countRows as any[])[0]?.total ?? 0);

    const results = await Promise.allSettled(
      (empRows as any[]).map(async (emp: any) => {
        try {
          const finalized = await getFinalizedLineForMonth(emp.id, runMonthYYYYMM);
          if (finalized) {
            return {
              employee_id: emp.id, employee_code: emp.employee_code, name: emp.name,
              branch_name: emp.branch_name, process_name: emp.process_name, designation_name: emp.designation_name,
              ...finalized,
            };
          }
          const summary = await computeRunningSalary(emp.id, runMonth);
          return {
            employee_id: emp.id, employee_code: emp.employee_code, name: emp.name,
            branch_name: emp.branch_name, process_name: emp.process_name, designation_name: emp.designation_name,
            ...summary,
          };
        } catch {
          return { employee_id: emp.id, employee_code: emp.employee_code, name: emp.name, error: true };
        }
      })
    );

    const data = results
      .filter((r) => r.status === "fulfilled")
      .map((r) => (r as PromiseFulfilledResult<any>).value);

    return res.json({ success: true, data, run_month: runMonth, count: data.length, total, page, limit });
  }
);

/**
 * GET /api/payroll/running-summary-aggregate?month=YYYY-MM&group_by=branch|process|cost_centre&branch_id=&process_id=
 *
 * Returns running-month salary AGGREGATED by branch, process, or cost centre.
 * Used by the Running Salary Center's scope-level summary views.
 *
 * Each group row shows: headcount, total_gross, total_net, finalized_count, estimate_count.
 * For finalized employees the stored salary_prep_line figures are used directly.
 * For non-finalized employees the monthly gross from employee_salary_assignment is used as
 * a projection base (same conservative approximation as payroll governance checks).
 *
 * This endpoint never calls computeRunningSalary per-employee — it is a pure SQL aggregate
 * so it responds in milliseconds regardless of headcount.
 */
runningSalaryRouter.get(
  "/running-summary-aggregate",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.authUser!.id;
    if (
      !(await hasAnyRole(
        userId,
        "super_admin", "admin", "payroll_head", "payroll_branch", "payroll",
        "branch_head", "management", "hr", "hr_admin", "wfm", "process_manager",
      ))
    ) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { db } = await import("../../db/mysql.js");

    const rawMonth = (req.query.month as string) || "";
    let runMonthYYYYMM: string;
    if (rawMonth && /^\d{4}-\d{2}$/.test(rawMonth)) {
      runMonthYYYYMM = rawMonth;
    } else {
      runMonthYYYYMM = await resolveDefaultRunMonth(db);
    }

    const groupBy = (req.query.group_by as string) || "branch";
    if (!["branch", "process", "cost_centre"].includes(groupBy)) {
      return res.status(400).json({ success: false, message: "group_by must be branch, process, or cost_centre" });
    }

    const { branch_id, process_id } = req.query as Record<string, string>;

    // Build scope clause — restricts to the caller's assigned scope
    const scoped = await buildScopeWhereClause(
      userId,
      RUNNING_SALARY_SCOPE_ROLES,
      EMPLOYEE_SCOPE_ALIASES,
      { allowAdminBypass: true, allowCeoAllRead: true },
    );

    const conds: string[] = [
      "e.employment_status = 'active'",
      "esa.active_status = 1",
      `(${scoped.sql})`,
    ];
    const params: unknown[] = [...scoped.params];

    if (branch_id) { conds.push("e.branch_id = ?"); params.push(branch_id); }
    if (process_id) { conds.push("e.process_id = ?"); params.push(process_id); }

    // Choose group columns based on group_by
    let groupIdExpr: string;
    let groupNameExpr: string;
    let groupLabel: string;
    let extraJoin = "";

    if (groupBy === "branch") {
      groupIdExpr = "e.branch_id";
      groupNameExpr = "COALESCE(bm.branch_name, 'Unassigned')";
      groupLabel = "branch";
    } else if (groupBy === "process") {
      groupIdExpr = "e.process_id";
      groupNameExpr = "COALESCE(pm.process_name, 'Unassigned')";
      groupLabel = "process";
    } else {
      groupIdExpr = "e.cost_centre_id";
      groupNameExpr = "COALESCE(cc.cost_centre_name, 'Unassigned')";
      groupLabel = "cost_centre";
      extraJoin = "LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id";
    }

    const whereSql = conds.join(" AND ");

    // Aggregate query:
    // - For employees with a finalized salary_prep_line in this month: use stored gross/net
    // - For others: use esa.gross_amount (monthly CTC gross) as projection
    // One LEFT JOIN on salary_prep_line — picks the most authoritative status (same ORDER as batch endpoint)
    const sql = `
      SELECT
        ${groupIdExpr} AS group_id,
        ${groupNameExpr} AS group_name,
        COUNT(DISTINCT e.id) AS headcount,
        SUM(COALESCE(spl.gross_salary, esa.gross_amount, 0)) AS total_gross,
        SUM(COALESCE(spl.net_salary, esa.gross_amount * 0.85, 0)) AS total_net,
        SUM(CASE WHEN spl.id IS NOT NULL THEN 1 ELSE 0 END) AS finalized_count,
        SUM(CASE WHEN spl.id IS NULL THEN 1 ELSE 0 END) AS estimate_count,
        AVG(COALESCE(spl.gross_salary, esa.gross_amount, 0)) AS avg_gross
      FROM employees e
      JOIN employee_salary_assignment esa ON esa.employee_id = e.id AND esa.active_status = 1
      LEFT JOIN branch_master bm ON bm.id = e.branch_id
      LEFT JOIN process_master pm ON pm.id = e.process_id
      ${extraJoin}
      LEFT JOIN (
        SELECT spl2.employee_id, spl2.gross_salary, spl2.net_salary, spl2.id
        FROM salary_prep_line spl2
        JOIN salary_prep_run spr2 ON spr2.id = spl2.run_id
        WHERE spr2.run_month = ?
          AND spr2.status IN ('locked','approved','disbursed','completed','finalized','draft','processing','calculating','calculated')
          AND spl2.status NOT IN ('excluded','blocked')
        ORDER BY
          CASE spr2.status
            WHEN 'disbursed'   THEN 1 WHEN 'finalized' THEN 2 WHEN 'locked'      THEN 3
            WHEN 'approved'    THEN 4 WHEN 'completed' THEN 5 WHEN 'calculated'  THEN 6
            WHEN 'processing'  THEN 7 WHEN 'calculating' THEN 8 WHEN 'draft'     THEN 9
            ELSE 10 END
        LIMIT 18446744073709551615
      ) spl ON spl.employee_id = e.id
      WHERE ${whereSql}
      GROUP BY ${groupIdExpr}, ${groupNameExpr}
      ORDER BY total_gross DESC
    `;

    // Params: runMonthYYYYMM for the subquery, then scope/filter params
    const allParams = [runMonthYYYYMM, ...params];

    try {
      const [rows] = await (db as any).execute(sql, allParams);
      const data = (rows as any[]).map((r: any) => ({
        group_id:        r.group_id,
        group_name:      r.group_name,
        group_type:      groupLabel,
        headcount:       Number(r.headcount ?? 0),
        total_gross:     Math.round(Number(r.total_gross ?? 0)),
        total_net:       Math.round(Number(r.total_net ?? 0)),
        avg_gross:       Math.round(Number(r.avg_gross ?? 0)),
        finalized_count: Number(r.finalized_count ?? 0),
        estimate_count:  Number(r.estimate_count ?? 0),
      }));

      return res.json({
        success: true,
        data,
        run_month: runMonthYYYYMM,
        group_by: groupLabel,
        total_headcount: data.reduce((s: number, r: any) => s + r.headcount, 0),
        total_gross:     data.reduce((s: number, r: any) => s + r.total_gross, 0),
        total_net:       data.reduce((s: number, r: any) => s + r.total_net, 0),
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, message: err.message });
    }
  }
);
