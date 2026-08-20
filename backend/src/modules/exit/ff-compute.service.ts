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
 * Phase 2 (this revision) adds asset recovery and a TDS final-year true-up. Both stay on
 * the same discipline: asset recovery is the full purchase cost of anything not returned
 * (no depreciation concept exists anywhere in this codebase — inventing one would be a
 * business-policy decision, not a bug fix). The TDS true-up is deliberately conservative
 * where the codebase has no answer: there is no income-tax exemption-limit concept for
 * gratuity or leave encashment anywhere here (only the Payment of Gratuity Act's payout
 * ceiling, a different thing), so leave encashment is treated as fully taxable by default
 * (safer to over-withhold than leave the employer under-deducted) unless a real
 * leave_encashment_tax_exemption_limit is configured, and gratuity stays non-taxable,
 * matching ff.service.ts's own already-shipped behaviour (tax_deducted is always 0 for
 * gratuity in this path today — Phase 2 does not change that).
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { getPolicyValue } from "../policy-engine/policy-engine.cache.js";
import { taxEngineService } from "../payroll-compliance/taxEngine.service.js";
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

  /** Full purchase cost of every asset still assigned (not returned). No depreciation applied. */
  asset_recovery: {
    open_assignments: Array<{ asset_code: string; asset_name: string; purchase_cost: number }>;
    total_recovery: ComputedComponent<number>;
  };

  /**
   * Shortfall to collect (positive) or excess to refund (negative) if the whole FY's tax
   * liability is settled now instead of spread over the rest of a FY that, for a leaver,
   * never comes. Preview only — does not feed into net_payable/salary_hold automatically.
   */
  tds_true_up: {
    financial_year: string;
    ytd_gross: number;
    ytd_tds_deducted: number;
    months_paid: number;
    leave_encashment_taxable_amount: number;
    true_up_amount: ComputedComponent<number>;
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

async function resolveAssetRecovery(employeeId: string): Promise<FfComputePreview["asset_recovery"]> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT a.asset_code, a.asset_name, COALESCE(a.purchase_cost, 0) AS purchase_cost
         FROM asset_assignment aa
         JOIN asset_master a ON a.id = aa.asset_id
        WHERE aa.employee_id = ? AND aa.returned_date IS NULL`,
      [employeeId]
    );
    const openAssignments = (rows as Array<{ asset_code: string; asset_name: string; purchase_cost: number }>)
      .map((r) => ({ asset_code: r.asset_code, asset_name: r.asset_name, purchase_cost: Number(r.purchase_cost) }));
    const total = Math.round(openAssignments.reduce((sum, a) => sum + a.purchase_cost, 0) * 100) / 100;
    return {
      open_assignments: openAssignments,
      total_recovery: computed(
        total,
        openAssignments.length
          ? `Full purchase cost of ${openAssignments.length} unreturned asset(s) — no depreciation policy exists in this system, so this is the undepreciated original cost.`
          : "No unreturned assets on file."
      ),
    };
  } catch (err) {
    // Same non-fatal posture as the employee_loans lookup above — an unavailable asset
    // table must not take down the whole preview.
    return { open_assignments: [], total_recovery: pending(0, `Asset recovery could not be determined: ${(err as Error).message}`) };
  }
}

/**
 * FY (April–March) that a given date falls in, as e.g. "2026-27".
 */
function financialYearFor(date: Date): { fyStart: number; label: string } {
  const y = date.getFullYear();
  const m = date.getMonth() + 1; // 1-12
  const fyStart = m >= 4 ? y : y - 1;
  return { fyStart, label: `${fyStart}-${String(fyStart + 1).slice(2)}` };
}

async function resolveTdsTrueUp(
  employeeId: string,
  lastWorkingDay: string | null,
  leaveEncashmentAmount: number | null
): Promise<FfComputePreview["tds_true_up"]> {
  const asOf = lastWorkingDay ? new Date(lastWorkingDay) : new Date();
  const { fyStart, label } = financialYearFor(asOf);
  const fyFirstMonth = `${fyStart}-04`;
  const fyLastMonth = `${fyStart + 1}-03`;
  const emptyBase = { financial_year: label, ytd_gross: 0, ytd_tds_deducted: 0, months_paid: 0, leave_encashment_taxable_amount: 0 };

  // Everything below — the YTD sum, declaration/DOB lookups, and the tax-engine call — is one
  // try/catch: any of them failing (an unavailable table, an ambiguous slab config) must
  // degrade this one component to pending_configuration, not crash the whole preview. Same
  // non-fatal posture as asset recovery / advances-loans above.
  try {
    // Same canonical-per-month YTD aggregation payroll.routes.ts's /form16-data route already
    // uses — real, backward-looking actuals, never a forward projection. For a leaver this
    // naturally stops at whatever months actually happened; if the exit month's own payroll
    // run hasn't been calculated/approved yet, its income is not yet reflected here.
    const [fyRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS months_paid,
              COALESCE(SUM(gross_salary), 0) AS gross_salary,
              COALESCE(SUM(tds_deducted), 0) AS tds_deducted
         FROM (
           SELECT spr.run_month, spl.gross_salary,
                  COALESCE(NULLIF(spl.tds_amount, 0), spl.tds) AS tds_deducted,
                  ROW_NUMBER() OVER (
                    PARTITION BY spr.run_month
                    ORDER BY FIELD(spr.status, 'disbursed', 'finalized', 'locked', 'approved', 'completed'),
                             spr.created_at DESC
                  ) AS rn
             FROM salary_prep_line spl
             JOIN salary_prep_run spr ON spr.id = spl.run_id
            WHERE spl.employee_id = ?
              AND spr.run_month BETWEEN ? AND ?
              AND spr.status IN ('locked', 'finalized', 'approved', 'disbursed', 'completed')
              AND spl.status NOT IN ('excluded', 'blocked')
         ) canonical
        WHERE canonical.rn = 1`,
      [employeeId, fyFirstMonth, fyLastMonth]
    );
    const fy = (fyRows as Array<{ months_paid: number; gross_salary: number; tds_deducted: number }>)[0];
    const ytdGross = Number(fy?.gross_salary ?? 0);
    const ytdTds = Number(fy?.tds_deducted ?? 0);
    const monthsPaid = Number(fy?.months_paid ?? 0);

    // Leave encashment: fully taxable by default (conservative — an under-collected true-up
    // is an employer liability with interest; an over-collected one is merely refundable on
    // the employee's own return). Exempted up to a configured limit only if one has actually
    // been approved — never guessed.
    const [cfgRows] = await db.execute<RowDataPacket[]>(
      `SELECT config_value FROM statutory_config
        WHERE config_key = 'leave_encashment_tax_exemption_limit' AND is_active = 1
        LIMIT 1`
    );
    const exemptionLimit = (cfgRows as Array<{ config_value: string }>)[0]
      ? Number((cfgRows as Array<{ config_value: string }>)[0].config_value)
      : 0;
    const rawEncashment = leaveEncashmentAmount ?? 0;
    const taxableEncashment = Math.max(0, rawEncashment - exemptionLimit);

    const [declRows] = await db.execute<RowDataPacket[]>(
      "SELECT declared_hra, declared_80c, declared_80d, regime FROM tax_declaration WHERE employee_id = ? AND financial_year = ? LIMIT 1",
      [employeeId, label]
    );
    const decl = (declRows as Array<{ declared_hra: number; declared_80c: number; declared_80d: number; regime: string | null }>)[0];

    const [empRows] = await db.execute<RowDataPacket[]>(
      "SELECT date_of_birth FROM employees WHERE id = ? LIMIT 1",
      [employeeId]
    );
    const dob = (empRows as Array<{ date_of_birth: string | null }>)[0]?.date_of_birth;
    let employeeAge: number | null = null;
    if (dob) {
      const d = new Date(dob);
      let age = asOf.getFullYear() - d.getFullYear();
      const mDiff = asOf.getMonth() - d.getMonth();
      if (mDiff < 0 || (mDiff === 0 && asOf.getDate() < d.getDate())) age--;
      employeeAge = age;
    }

    const base = { financial_year: label, ytd_gross: ytdGross, ytd_tds_deducted: ytdTds, months_paid: monthsPaid, leave_encashment_taxable_amount: taxableEncashment };

    // annualGross here IS the full year's actual income — YTD actuals plus the taxable
    // leave-encashment addition. No forward projection: exit month is definitionally the
    // last month of income for this FY, so there is nothing left to project.
    const result = await taxEngineService.calculateMonthlyTds({
      financialYear: label,
      annualGross: ytdGross + taxableEncashment,
      alreadyDeducted: ytdTds,
      declaration: decl ? {
        regime: decl.regime,
        declared_hra: Number(decl.declared_hra) || 0,
        declared_80c: Number(decl.declared_80c) || 0,
        declared_80d: Number(decl.declared_80d) || 0,
      } : null,
      monthsRemaining: 1,
      employeeAge,
    });
    // tax_annual already applies the correct slabs/rebate/cess — subtract what's already
    // been deducted ourselves (not via tds_monthly, which floors at 0) so an overpayment
    // surfaces as a negative true-up (refund), not a silently-hidden zero.
    const trueUp = Math.round((result.tax_annual - ytdTds) * 100) / 100;
    return { ...base, true_up_amount: computed(trueUp, `FY ${label} liability ${result.tax_annual.toFixed(2)} less ${ytdTds.toFixed(2)} already deducted across ${monthsPaid} paid month(s). ${trueUp < 0 ? "Negative = refund due." : "Positive = additional amount to collect."}`) };
  } catch (err) {
    return {
      ...emptyBase,
      true_up_amount: pending(0, `TDS true-up could not be computed: ${(err as Error).message}`),
    };
  }
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

  const [leaveEncashment, gratuity, advancesLoans, assetRecovery, payrollAlreadyPaid] = await Promise.all([
    resolveLeaveEncashment(exitReq.employee_id, asOfYear, grossMonthly),
    ffService.calculateGratuityFromEmployee(exitReq.employee_id, notice.lastWorkingDay ?? undefined),
    resolveAdvancesLoansFullPayoff(exitReq.employee_id),
    resolveAssetRecovery(exitReq.employee_id),
    ffService.getPayrollAlreadyPaid(exitReq.employee_id, notice.lastWorkingDay ?? new Date().toISOString().slice(0, 10)),
  ]);

  // Depends on leaveEncashment's resolved amount, so runs after the batch above rather than
  // inside it — a taxable-income figure computed from a still-in-flight value would be wrong.
  const tdsTrueUp = await resolveTdsTrueUp(
    exitReq.employee_id,
    notice.lastWorkingDay,
    leaveEncashment.amount.status === "computed" ? leaveEncashment.amount.value : null
  );

  const { lastWorkingDay, ...noticeRest } = notice;

  return {
    exit_request_id: exitRequestId,
    employee_id: exitReq.employee_id,
    as_of_date: lastWorkingDay,
    notice: noticeRest,
    leave_encashment: leaveEncashment,
    gratuity,
    advances_loans: advancesLoans,
    asset_recovery: assetRecovery,
    tds_true_up: tdsTrueUp,
    payroll_already_paid: payrollAlreadyPaid,
  };
}
