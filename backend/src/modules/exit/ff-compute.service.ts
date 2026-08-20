/**
 * Full & Final settlement — Phase 1 compute/preview engine.
 *
 * ff.service.ts's createFF() takes every component (notice recovery, leave encashment,
 * gratuity, advances recovery) as a caller-typed number and only checks that the total
 * agrees with its own parts (ffComponentSum) — it does not derive any of them. This file
 * is the derivation layer that was missing: given an exit request, it computes what each
 * component SHOULD be from real data, so HR gets a real prefilled figure instead of a
 * blank form. It writes nothing — createFF is unchanged and remains the only write path.
 *
 * Every component is tagged computed / not_applicable / pending_configuration. Nothing
 * here invents a rate or a policy value that isn't actually configured — the same
 * discipline calculateTds/calculateGratuity already apply. A pending_configuration
 * component is not an error; it's an honest "cannot be computed yet," and createFF
 * already forces is_ff_provisional=1 on every new settlement regardless, so the existing
 * approval gate (which requires setProvisionalFalse + a reason to clear) is what actually
 * enforces that a settlement resting on unconfigured rates cannot be approved silently.
 *
 * Out of scope (Phase 2): asset recovery (asset_assignment has no cost column), TDS
 * final-year true-up on the exit month.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getPolicyValue } from "../policy-engine/policy-engine.cache.js";
import { ffService, type GratuityCalculation, type PayrollAlreadyPaid } from "./ff.service.js";

export type ComputedStatus = "computed" | "not_applicable" | "pending_configuration";

export interface ComputedComponent<T = number> {
  value: T;
  status: ComputedStatus;
  note: string;
}

function computed<T>(value: T, note: string): ComputedComponent<T> {
  return { value, status: "computed", note };
}
function pending<T>(value: T, note: string): ComputedComponent<T> {
  return { value, status: "pending_configuration", note };
}
function notApplicable<T>(value: T, note: string): ComputedComponent<T> {
  return { value, status: "not_applicable", note };
}

export interface FfComputePreview {
  exit_request_id: string;
  employee_id: string;
  as_of_date: string | null;

  notice: {
    required_days: ComputedComponent<number>;
    served_days: number | null;
    shortfall_days: ComputedComponent<number>;
    per_day_rate: ComputedComponent<number>;
    recovery_amount: ComputedComponent<number>;
  };

  leave_encashment: {
    el_balance_days: number | null;
    per_day_rate: ComputedComponent<number>;
    amount: ComputedComponent<number>;
  };

  gratuity: GratuityCalculation;

  advances_loans: {
    salary_advances_outstanding: number;
    employee_loans_outstanding: number;
    total_recovery: ComputedComponent<number>;
  };

  payroll_already_paid: PayrollAlreadyPaid[];
}

interface ExitRequestRow extends RowDataPacket {
  employee_id: string;
  notice_period_days: number;
  submitted_at: string | null;
  last_working_day: string | null;
  served_days: number | null;
}

/**
 * Last active salary assignment's monthly gross (ctc_annual / 12) — the same
 * employee_salary_assignment/salary_structure_master lookup calculateGratuityFromEmployee
 * already uses. Shared here rather than queried twice per preview.
 */
async function resolveGrossMonthly(employeeId: string): Promise<number | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT esa.ctc_annual
       FROM employee_salary_assignment esa
      WHERE esa.employee_id = ? AND esa.active_status = 1
      ORDER BY esa.effective_from DESC
      LIMIT 1`,
    [employeeId]
  );
  const row = (rows as Array<{ ctc_annual: number }>)[0];
  if (!row) return null;
  return Number(row.ctc_annual) / 12;
}

async function resolveNoticeShortfall(
  exitRequestId: string,
  employeeId: string,
  grossMonthly: number | null
): Promise<FfComputePreview["notice"] & { lastWorkingDay: string | null }> {
  const [rows] = await db.execute<ExitRequestRow[]>(
    `SELECT er.employee_id, er.notice_period_days, er.submitted_at,
            COALESCE(er.last_working_day_confirmed, er.last_working_day_proposed) AS last_working_day,
            DATEDIFF(COALESCE(er.last_working_day_confirmed, er.last_working_day_proposed), er.submitted_at) AS served_days
       FROM exit_request er
      WHERE er.id = ?
      LIMIT 1`,
    [exitRequestId]
  );
  const row = rows[0];
  const lastWorkingDay = row?.last_working_day ?? null;

  if (!row) {
    const zero = pending(0, "Exit request not found.");
    return {
      required_days: zero, served_days: null, shortfall_days: zero,
      per_day_rate: zero, recovery_amount: zero, lastWorkingDay: null,
    };
  }

  const requiredDays = Number(row.notice_period_days ?? 0);
  const servedDays = row.served_days === null ? null : Number(row.served_days);

  // notice_period_days = 0 is ambiguous — could be a genuine "no notice required" or simply
  // never filled in on the resignation form. Treated as unconfirmed rather than a real zero,
  // the same way calculateGratuity distinguishes "not configured" from "genuinely 0 years".
  const requiredComponent = requiredDays > 0
    ? computed(requiredDays, "From the notice period recorded on this exit request.")
    : pending(0, "No notice period was recorded on this exit request. Confirm the employee's contractual notice period before relying on this figure.");

  const divisor = Number(await getPolicyValue("payroll", "calculation", "default_working_days", "26"));
  const perDayRate: ComputedComponent<number> = grossMonthly === null
    ? pending(0, "No active salary assignment found for employee.")
    : computed(Math.round((grossMonthly / divisor) * 100) / 100, `Last gross monthly (${grossMonthly.toFixed(2)}) / ${divisor} working days.`);

  if (requiredComponent.status === "pending_configuration" || perDayRate.status === "pending_configuration") {
    const zero = pending(0, "Cannot compute until required notice days and per-day rate are both known.");
    return {
      required_days: requiredComponent, served_days: servedDays,
      shortfall_days: zero, per_day_rate: perDayRate, recovery_amount: zero,
      lastWorkingDay,
    };
  }

  const shortfallDays = Math.max(0, requiredDays - (servedDays ?? 0));
  const shortfallComponent = computed(shortfallDays, `${requiredDays} required − ${servedDays ?? 0} served, floored at 0.`);
  const recoveryAmount = Math.round(shortfallDays * perDayRate.value * 100) / 100;

  return {
    required_days: requiredComponent,
    served_days: servedDays,
    shortfall_days: shortfallComponent,
    per_day_rate: perDayRate,
    recovery_amount: computed(recoveryAmount, `${shortfallDays} shortfall day(s) × ${perDayRate.value.toFixed(2)}/day.`),
    lastWorkingDay,
  };
}

async function resolveLeaveEncashment(
  employeeId: string,
  year: number,
  grossMonthly: number | null
): Promise<FfComputePreview["leave_encashment"]> {
  const { leaveService } = await import("../leave/leave.service.js");
  const balances = await leaveService.getBalance(employeeId, year);
  const el = (balances as Array<{ leave_code?: string; available_days?: number }>).find(
    (b) => String(b.leave_code ?? "").toUpperCase() === "EL"
  );

  if (!el) {
    const na = notApplicable(0, "No Earned Leave (EL) balance record exists for this employee.");
    return { el_balance_days: null, per_day_rate: na, amount: na };
  }

  const elBalanceDays = Number(el.available_days ?? 0);

  const [cfgRows] = await db.execute<RowDataPacket[]>(
    `SELECT config_value FROM statutory_config
      WHERE config_key = 'leave_encashment_day_divisor' AND is_active = 1
      LIMIT 1`
  );
  const divisor = (cfgRows as Array<{ config_value: string }>)[0]
    ? Number((cfgRows as Array<{ config_value: string }>)[0].config_value)
    : undefined;

  if (!divisor || !Number.isFinite(divisor) || divisor <= 0) {
    const pend = pending(0, "Leave encashment rate is not configured. statutory_config needs an active leave_encashment_day_divisor before this can be calculated.");
    return { el_balance_days: elBalanceDays, per_day_rate: pend, amount: pend };
  }

  if (grossMonthly === null) {
    const pend = pending(0, "No active salary assignment found for employee.");
    return { el_balance_days: elBalanceDays, per_day_rate: pend, amount: pend };
  }

  const perDayRate = Math.round((grossMonthly / divisor) * 100) / 100;
  const amount = Math.round(perDayRate * elBalanceDays * 100) / 100;
  return {
    el_balance_days: elBalanceDays,
    per_day_rate: computed(perDayRate, `Last gross monthly (${grossMonthly.toFixed(2)}) / ${divisor} (leave_encashment_day_divisor).`),
    amount: computed(amount, `${elBalanceDays} EL day(s) × ${perDayRate.toFixed(2)}/day.`),
  };
}

async function resolveAdvancesLoansFullPayoff(employeeId: string): Promise<FfComputePreview["advances_loans"]> {
  const [advRows] = await db.execute<RowDataPacket[]>(
    `SELECT COALESCE(SUM(amount - COALESCE(recovered_amount, 0)), 0) AS outstanding
       FROM salary_advance_log
      WHERE employee_id = ? AND status = 'active'`,
    [employeeId]
  );
  const advancesOutstanding = Number((advRows as Array<{ outstanding: number }>)[0]?.outstanding ?? 0);

  // Full remaining balance, not the monthly installment — payrollCalculate.service.ts's
  // ordinary-payroll recovery only ever sums the per-month figure (ROUND(amount/recovery_months)
  // for advances, deduction_per_month for loans); F&F must recover the whole thing in one shot.
  let loansOutstanding = 0;
  try {
    const [loanRows] = await db.execute<RowDataPacket[]>(
      `SELECT COALESCE(SUM(pending_amount), 0) AS outstanding
         FROM employee_loans
        WHERE employee_id = ? AND status = 'active'`,
      [employeeId]
    );
    loansOutstanding = Number((loanRows as Array<{ outstanding: number }>)[0]?.outstanding ?? 0);
  } catch {
    // employee_loans table may not exist — non-fatal, matches payrollCalculate.service.ts's
    // treatment of the same table.
  }

  const total = Math.round((advancesOutstanding + loansOutstanding) * 100) / 100;
  return {
    salary_advances_outstanding: advancesOutstanding,
    employee_loans_outstanding: loansOutstanding,
    total_recovery: computed(total, "Full outstanding balance of active salary advances + active loans — not a monthly installment."),
  };
}

export async function computeFfPreview(exitRequestId: string): Promise<FfComputePreview> {
  const [exitRows] = await db.execute<RowDataPacket[]>(
    "SELECT id, employee_id FROM exit_request WHERE id = ? LIMIT 1",
    [exitRequestId]
  );
  const exitReq = (exitRows as Array<{ id: string; employee_id: string }>)[0];
  if (!exitReq) throw Object.assign(new Error("Exit request not found"), { statusCode: 404 });

  const grossMonthly = await resolveGrossMonthly(exitReq.employee_id);
  const notice = await resolveNoticeShortfall(exitRequestId, exitReq.employee_id, grossMonthly);
  const asOfYear = notice.lastWorkingDay ? new Date(notice.lastWorkingDay).getFullYear() : new Date().getFullYear();

  const [leaveEncashment, gratuity, advancesLoans, payrollAlreadyPaid] = await Promise.all([
    resolveLeaveEncashment(exitReq.employee_id, asOfYear, grossMonthly),
    ffService.calculateGratuityFromEmployee(exitReq.employee_id, notice.lastWorkingDay ?? undefined),
    resolveAdvancesLoansFullPayoff(exitReq.employee_id),
    ffService.getPayrollAlreadyPaid(exitReq.employee_id, notice.lastWorkingDay ?? new Date().toISOString().slice(0, 10)),
  ]);

  const { lastWorkingDay, ...noticeRest } = notice;

  return {
    exit_request_id: exitRequestId,
    employee_id: exitReq.employee_id,
    as_of_date: lastWorkingDay,
    notice: noticeRest,
    leave_encashment: leaveEncashment,
    gratuity,
    advances_loans: advancesLoans,
    payroll_already_paid: payrollAlreadyPaid,
  };
}
