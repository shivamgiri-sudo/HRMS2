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
import { hasAnyRole } from "../../shared/scopeAccess.js";
import { computeRunningSalary } from "./running-salary.service.js";
import { toISTDate } from "../../shared/timezone.js";
import type { RowDataPacket } from "mysql2/promise";
import type { Response } from "express";

export const runningSalaryRouter = Router();

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
  is_finalized: true;
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
        AND spr.status IN ('locked', 'approved', 'disbursed', 'completed')
        AND spl.status NOT IN ('excluded', 'blocked')
      ORDER BY
        CASE spr.status
          WHEN 'disbursed'  THEN 1
          WHEN 'locked'     THEN 2
          WHEN 'approved'   THEN 3
          WHEN 'completed'  THEN 4
          ELSE 5
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
  return {
    run_status:           String(row.run_status),
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
    is_finalized:         true,
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
      runMonthYYYYMM = currentIstRunMonth();
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
    const rawMonth = (req.query.month as string) || "";

    let runMonthYYYYMM: string;
    let runMonth: string;
    if (rawMonth && /^\d{4}-\d{2}$/.test(rawMonth)) {
      runMonthYYYYMM = rawMonth;
      runMonth = `${rawMonth}-01`;
    } else {
      runMonthYYYYMM = currentIstRunMonth();
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
 * GET /api/payroll/running-summary/batch?month=YYYY-MM&branch_id=...&process_id=...&limit=50
 * Batch running summary for a branch or process (management dashboard).
 * Returns an array of {employee_id, employee_code, name, ...summary} for up to 100 employees.
 * Each employee uses finalized line if available, otherwise live estimate.
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
        "branch_head", "management"
      ))
    ) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const rawMonth = (req.query.month as string) || "";
    let runMonthYYYYMM: string;
    let runMonth: string;
    if (rawMonth && /^\d{4}-\d{2}$/.test(rawMonth)) {
      runMonthYYYYMM = rawMonth;
      runMonth = `${rawMonth}-01`;
    } else {
      runMonthYYYYMM = currentIstRunMonth();
      runMonth = `${runMonthYYYYMM}-01`;
    }

    const { branch_id, process_id } = req.query as Record<string, string>;
    const limitRaw = parseInt((req.query.limit as string) || "50", 10);
    const limit = Math.min(Math.max(1, limitRaw), 100);

    const { db } = await import("../../db/mysql.js");

    const conds: string[] = [
      "e.employment_status = 'active'",
      "esa.active_status = 1",
    ];
    const params: unknown[] = [];
    if (branch_id) { conds.push("e.branch_id = ?"); params.push(branch_id); }
    if (process_id) { conds.push("e.process_id = ?"); params.push(process_id); }

    const [empRows] = await (db as any).execute(
      `SELECT e.id, e.employee_code, CONCAT(e.first_name, ' ', e.last_name) AS name
         FROM employees e
         JOIN employee_salary_assignment esa ON esa.employee_id = e.id
        WHERE ${conds.join(" AND ")}
        LIMIT ${limit}`,
      params
    );

    const results = await Promise.allSettled(
      (empRows as any[]).map(async (emp: any) => {
        try {
          const finalized = await getFinalizedLineForMonth(emp.id, runMonthYYYYMM);
          if (finalized) {
            return { employee_id: emp.id, employee_code: emp.employee_code, name: emp.name, ...finalized };
          }
          const summary = await computeRunningSalary(emp.id, runMonth);
          return { employee_id: emp.id, employee_code: emp.employee_code, name: emp.name, ...summary };
        } catch {
          return { employee_id: emp.id, employee_code: emp.employee_code, name: emp.name, error: true };
        }
      })
    );

    const data = results
      .filter((r) => r.status === "fulfilled")
      .map((r) => (r as PromiseFulfilledResult<any>).value);

    return res.json({ success: true, data, run_month: runMonth, count: data.length });
  }
);
