import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logger } from "../../lib/logger.js";
import { missingTdsConfigKeys } from "./statutory-regime.js";
// The closed-run set was `["locked", "disbursed"]`, which matched no row in
// production — runs finish as FINALIZED — so this guard never fired.
import { isRunClosed, CLOSED_RUN_STATUSES_SQL } from "./run-status.js";
import { isProfessionalTaxExempt } from "./professional-tax-states.js";
import {
  EMPLOYMENT_END_DATE_SELECT,
  employmentWindowPredicate,
  payableThrough,
} from "./employment-end-date.js";
import { loadFlatStatutoryConfig } from "./statutory-config.loader.js";
import { getStatutoryConfigForPeriod } from "./statutory-config.resolver.js";
import { payrollService, breakSpecialAllowance } from "./payroll.service.js";
import type { SalaryPrepRun } from "./payroll.types.js";
import { maternityService } from "../compliance/maternity.service.js";
import { calculateWeekoffEligibility } from "./weekoff-eligibility.service.js";
import { resolveHolidaysForEmployeeV2 } from "./holiday-work.service.js";
import { checkAndReverseLeave } from "./leave-reversal.service.js";
import { detectAndCalculateHolidayWork, isHolidayWorkAutoGenEnabled } from "./holiday-work-auto.service.js";
import { taxEngineService } from "../payroll-compliance/taxEngine.service.js";
import { getPolicyValue } from "../policy-engine/policy-engine.cache.js";
import { esiContributionPeriodStart } from "./payroll-governance.service.js";

interface TaxDeclarationRow {
  declared_hra: number;
  declared_80c: number;
  declared_80d: number;
  regime: string;
}


// ─── Gross/deductions/net reconciliation ───────────────────────────────────────

/**
 * Reconcile a payroll line's gross, total deductions and net pay so they
 * always satisfy `net = gross - deductions`.
 *
 * calculateNetSalary (payroll.service.ts) has no floor on net: if statutory
 * plus other deductions exceed gross, it returns a negative number. The
 * caller used to clamp only the final net pay to 0 without correspondingly
 * reducing total_deductions, which stored lines where
 * `gross_salary - total_deductions !== net_salary` (e.g. gross=20000,
 * total_deductions=23000, net=0) — payslips and reports that recompute the
 * difference would misreport. Deductions are capped at what there is to
 * deduct instead, so net is always what's left and never negative.
 */
export function reconcileNetAndDeductions(
  grossForLine: number,
  rawDeductions: number
): { totalDeductions: number; netSalary: number } {
  const totalDeductions = Math.round(Math.min(rawDeductions, grossForLine) * 100) / 100;
  const netSalary = Math.round(Math.max(0, grossForLine - totalDeductions) * 100) / 100;
  return { totalDeductions, netSalary };
}

/**
 * Root-caused 2026-08-14: salary_prep_line.calculation_version and
 * salary_prep_run.payroll_model_version both exist in schema (NOT NULL
 * DEFAULT 'INDIA_COMPLIANCE_V1') specifically to answer "which logic version
 * computed this figure", but the live engine never wrote either — new rows
 * got the schema default, recalculated rows kept whatever version string
 * they already had, unrelated to what actually ran. After a future logic
 * change, every recalculated line would silently claim the OLD version
 * marker forever, making the columns actively misleading rather than merely
 * empty.
 *
 * Fixed by writing this constant explicitly on every INSERT and
 * recalculation. Deliberately set to the exact value the schema default
 * already uses — this commit changes NOTHING about what any run reports
 * today; it only makes the marker start tracking reality from here forward.
 * Bump this string (and only this string) the next time payroll calculation
 * logic changes in a way that should be distinguishable from what came
 * before — not for a fix to an adjacent concern like the payslip-component
 * generator, which does not change what any figure IS.
 */
export const CALCULATION_ENGINE_VERSION = "INDIA_COMPLIANCE_V1";

// ─── Payslip earning-component breakdown ───────────────────────────────────────

export interface PayslipEarningComponent {
  code: string;
  name: string;
  amount: number;
}

const PAYSLIP_COMPONENT_NAMES: Record<string, string> = {
  BASIC: "Basic Salary", HRA: "House Rent Allowance", BONUS: "Bonus",
  CONV: "Conveyance Allowance", PORTFOLIO: "Portfolio Allowance",
  MEDICAL: "Medical Allowance", LTA: "Leave Travel Allowance",
  SPECIAL: "Special Allowance", OTHER_ALLOW: "Other Allowance", PLI: "PLI",
};

/**
 * Builds the itemized earning-component breakdown for one salary_prep_line's
 * payslip. Extracted 2026-08-14 for testability, from logic that used to be
 * inline in calculatePayrollRunScoped — behaviour unchanged except for the two
 * fixes this exists to prove (PAYSLIP_COMPONENT_TOTAL_MISMATCH, root-caused
 * 2026-08-13):
 *
 * 1. LEFTOVER COMPONENT LEAKAGE. compAmounts is populated by the caller from
 *    TWO sources — the structure template (salary_structure_component) and,
 *    when present, the per-employee assignment (salary_component_assignments,
 *    "scaRow"). The assignment only ever knows about basic/hra/conveyance/
 *    special_allowance; any other code the template alone defined — BONUS,
 *    PORTFOLIO, MEDICAL, LTA, OTHER_ALLOW, PLI — must not be present in
 *    `compAmounts` by the time it reaches this function when
 *    `usedScaRowAssignment` is true, or it gets written as an extra earning
 *    component with no matching contribution to gross_salary (confirmed:
 *    MAS00175, July 2026, Portfolio Allowance ₹11,612.90 double-counted). The
 *    caller is responsible for resetting compAmounts on the assignment path;
 *    this function trusts what it is given.
 *
 * 2. SPECIAL RESIDUAL MISMATCH. The assignment's stored `special_allowance` is
 *    a static, independently-entered figure that is not guaranteed to equal
 *    the residual calculateNetSalary actually computed
 *    (grossMonthlyCTC - basic - hra) and gross_salary was built from. When
 *    `usedScaRowAssignment` is true, SPECIAL is therefore sourced from
 *    `calcSpecialAllowance` — the real computed residual, already fully
 *    prorated — not from any value inside `compAmounts` (confirmed: MAS63025,
 *    July 2026, ₹547.83 of real gross had no component row at all because the
 *    stored special_allowance was stale at 0). That residual has no concept
 *    of conveyance either — calculateNetSalary's formula never subtracts it
 *    — so it is already folded into the residual. Because CONV is written as
 *    its own line from `compAmounts.CONV`, its (prorated) value is subtracted
 *    back out of the residual before the remainder is written as SPECIAL, or
 *    conveyance would be double-counted a second time (caught by this fix's
 *    own tests, not by production data — always verify with an exact
 *    reconciliation, not a symbolic argument).
 *
 * Does not compute gross/net and cannot change them — calc.basic/calc.hra/
 * calc.special_allowance are treated here as given, already-authoritative
 * inputs from calculateNetSalary.
 */
export function buildPayslipEarningComponents(params: {
  hasFixedComponents: boolean;
  usedScaRowAssignment: boolean;
  compAmounts: Record<string, number>;
  ratio: number;
  /**
   * The ratio's numerator and denominator, when the caller has them.
   *
   * Proration MUST multiply before it divides. Precomputing `ratio = days / month` and
   * then multiplying loses the exact value at rounding boundaries, because the quotient
   * is not representable in binary floating point:
   *
   *   1333 * (8.5/31) = 365.49999999999994  -> Math.round = 365
   *   (1333 * 8.5)/31 = 365.5               -> Math.round = 366   <- db_bill
   *
   * MAS60179, 2026-05: db_bill stores Bonus1 = 366. db_bill computes in MySQL DECIMAL,
   * which is exact, and its identity ROUND(<Component> * EarnedDays / WorkingDays) holds
   * on every row from 2019 to 2026 with zero exceptions.
   *
   * Optional so existing callers keep working; when absent, `ratio` is used as-is.
   */
  ratioNumerator?: number;
  ratioDenominator?: number;
  calcBasic: number;
  calcHra: number;
  calcSpecialAllowance: number;
  convAllowanceDefault: number;
  medicalAllowanceDefault: number;
}): PayslipEarningComponent[] {
  const earnings: PayslipEarningComponent[] = [];
  // Multiply before dividing when the caller supplied the pair - see ratioNumerator.
  const rNum = params.ratioNumerator;
  const rDen = params.ratioDenominator;
  const prorate = (v: number): number =>
    rNum !== undefined && rDen !== undefined && rDen !== 0
      ? Math.round((v * rNum * 100) / rDen) / 100
      : Math.round(v * params.ratio * 100) / 100;

  if (params.hasFixedComponents) {
    for (const [code, val] of Object.entries(params.compAmounts)) {
      if (val > 0 && PAYSLIP_COMPONENT_NAMES[code]) {
        earnings.push({
          code,
          name: PAYSLIP_COMPONENT_NAMES[code],
          amount: prorate(val),
        });
      }
    }
    // No SPECIAL residual on this path any more. Every earning line, SPECIAL included, is
    // written from `compAmounts` in the loop above, which the caller populates from the
    // per-employee assignment. That is exactly how db_bill itemises: each component
    // prorated on its own, and Gross1 the sum of them. Rebuilding SPECIAL from
    // calculateNetSalary's residual double-counted every in-gross sibling except
    // conveyance, and could not agree with db_bill to the rupee even once corrected.
  } else {
    const { conv, ma, pa } = breakSpecialAllowance(
      params.calcSpecialAllowance,
      params.convAllowanceDefault,
      params.medicalAllowanceDefault,
    );
    earnings.push(
      { code: "BASIC", name: "Basic Salary", amount: params.calcBasic },
      { code: "HRA", name: "House Rent Allowance", amount: params.calcHra },
      { code: "CONV", name: "Conveyance Allowance", amount: conv },
      { code: "MA", name: "Medical Allowance", amount: ma },
      { code: "PA", name: "Personal Allowance", amount: pa },
    );
  }
  return earnings;
}

// ─── Gratuity ─────────────────────────────────────────────────────────────────

export interface GratuityResult {
  eligible: boolean;
  amount: number;
  years: number;
  /**
   * Why an ineligible result is ineligible. Without this a caller cannot tell
   * "this person has not served long enough" from "nobody has configured
   * gratuity", and the F&F screen reported the second as the first — telling a
   * twenty-year employee they had completed 0 years.
   */
  reason?: "not_configured" | "no_joining_date" | "below_minimum_service";
  /**
   * True when `amount` was reduced to fit the configured `gratuity_statutory_cap`
   * (Payment of Gratuity Act ceiling, currently Rs 20,00,000). `uncappedAmount` holds
   * what the formula produced before the cap was applied, for audit/display.
   */
  capApplied?: boolean;
  uncappedAmount?: number;
  /**
   * True when eligible/amount were computed with NO statutory cap configured at all
   * (`gratuity_statutory_cap` missing from statutory_config). CLAUDE.md requires a
   * cap to be configured before gratuity is non-provisional; until then this flag
   * lets callers (F&F review, approval gates) treat the amount as provisional rather
   * than final, without blocking every existing eligibility/config check that
   * already passed. See calculateGratuity below — the live path previously had no
   * cap parameter at all, so a settlement above the statutory ceiling would have
   * been paid in full with nothing catching it.
   */
  capMissing?: boolean;
}

/**
 * Calculate gratuity for an employee using the Payment of Gratuity Act formula:
 * amount = (lastBasicMonthly / divisor) * multiplier_days * completedYears
 * Eligibility: >= minimum months of continuous service.
 * All parameters read from statutory_config — no hardcoded fallbacks.
 *
 * KEY NAMES. This read three keys that statutory_config has never held. Production
 * seeds gratuity_divisor (26), gratuity_multiplier (15) and
 * gratuity_min_service_months (60) — the names migration 028 created — while this
 * asked for gratuity_day_divisor, gratuity_multiplier_days and gratuity_min_months.
 * All three lookups missed, so the function returned "not eligible" for everyone,
 * unconditionally, and an admin looking at the seeded rows in the statutory config
 * screen would reasonably conclude gratuity was configured.
 *
 * Both spellings are accepted so this is correct whichever an environment holds,
 * rather than trading one silent mismatch for another.
 *
 * AS-OF DATE. Tenure was measured to today. For a settlement that is prepared weeks
 * after someone leaves, that credits service they did not work and overstates the
 * payout. Callers settling an exit must pass the last working day; asOf defaults to
 * today only for live projections, where today is the right answer.
 */
export async function calculateGratuity(
  employeeId: string,
  lastBasicMonthly: number,
  asOf?: string | Date
): Promise<GratuityResult> {
  // Load statutory config parameters — no hardcoded defaults allowed
  const [cfgRows] = await db.execute<RowDataPacket[]>(
    `SELECT config_key, config_value FROM statutory_config
     WHERE config_key IN ('gratuity_min_months','gratuity_day_divisor','gratuity_multiplier_days',
                          'gratuity_min_service_months','gratuity_divisor','gratuity_multiplier',
                          'gratuity_statutory_cap')
       AND is_active = 1`,
    []
  );
  const cfg: Record<string, number> = {};
  for (const row of cfgRows as Array<{ config_key: string; config_value: string }>) {
    const val = Number(row.config_value);
    if (!Number.isFinite(val) || val <= 0) continue;
    cfg[String(row.config_key).toLowerCase()] = val;
  }

  const minMonths  = cfg["gratuity_min_service_months"] ?? cfg["gratuity_min_months"];
  const divisor    = cfg["gratuity_divisor"]            ?? cfg["gratuity_day_divisor"];
  const multiplier = cfg["gratuity_multiplier"]         ?? cfg["gratuity_multiplier_days"];

  // All three must be present — otherwise return a provisional block that says so.
  if (minMonths === undefined || divisor === undefined || multiplier === undefined) {
    return { eligible: false, amount: 0, years: 0, reason: "not_configured" };
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT date_of_joining FROM employees WHERE id = ? LIMIT 1",
    [employeeId]
  );
  const emp = (rows as Array<{ date_of_joining: string }>)[0];
  if (!emp?.date_of_joining) {
    return { eligible: false, amount: 0, years: 0, reason: "no_joining_date" };
  }

  const joinDate = new Date(emp.date_of_joining);
  const asOfDate = asOf ? new Date(asOf) : new Date();
  // Calendar-accurate month diff avoids floating-point imprecision of ms/30.4375 approach
  const totalCalendarMonths = (asOfDate.getFullYear() - joinDate.getFullYear()) * 12
    + (asOfDate.getMonth() - joinDate.getMonth());
  const fullYears = Math.floor(totalCalendarMonths / 12);
  const remainderMonths = totalCalendarMonths % 12;
  // s.4(2) Payment of Gratuity Act 1972: round up to next year when remainder > 6 months
  const eligibleYears = remainderMonths > 6 ? fullYears + 1 : fullYears;

  if (totalCalendarMonths < minMonths) {
    return { eligible: false, amount: 0, years: fullYears, reason: "below_minimum_service" };
  }

  const uncappedAmount = Math.round(
    ((lastBasicMonthly / divisor) * multiplier * eligibleYears) * 100
  ) / 100;

  const cap = cfg["gratuity_statutory_cap"];
  if (cap === undefined) {
    // No cap configured — CLAUDE.md requires one before gratuity is treated as
    // final. Amount is still returned (not blocked, to avoid disrupting every
    // exit that already relies on the eligibility/config checks above) but
    // flagged provisional so callers don't quietly pay an uncapped amount.
    return { eligible: true, amount: uncappedAmount, years: eligibleYears, capMissing: true };
  }

  const amount = Math.min(uncappedAmount, cap);
  return {
    eligible: true,
    amount,
    years: eligibleYears,
    ...(amount < uncappedAmount ? { capApplied: true, uncappedAmount } : {}),
  };
}

// ─── TDS ──────────────────────────────────────────────────────────────────────

export interface TdsResult {
  tds_annual: number;
  tds_monthly: number;
  effective_rate: number;
  /**
   * "pending_configuration" means no rate was applied because approved config
   * was absent — NOT that the employee owes nothing. A caller must treat the
   * zeros as unusable rather than deducting them.
   */
  status: "computed" | "pending_configuration";
  missing_config_keys: string[];
}

interface StatutoryConfigMap {
  [key: string]: number;
}

/**
 * Statutory rates a payable payroll run must use for its period.
 *
 * statutory_config_version is authoritative wherever it can be read: it is the
 * only source that can hold two financial years at once, and the only one that
 * records approval. The charter requires payable figures to rest on APPROVED
 * effective-dated configuration, so an unapproved row there is a proposal and
 * must not reach a payslip.
 *
 * The distinction that matters is between "versioning is not deployed here" and
 * "versioning is deployed and a key is missing":
 *
 *   unavailable — migration 1030 has not run on this database. Fall back to the
 *                 flat statutory_config, which is what payroll read before
 *                 versioning existed. That loader still filters is_active and
 *                 effective_from, so this is a period-resolved reading, never a
 *                 hardcoded rate. Failing the run here would break every
 *                 environment where 1030 has not yet been applied.
 *   versioned   — trust it completely, gaps included. Falling back on a missing
 *                 key would make the approval gate bypassable by omitting the
 *                 key: the stale flat row would quietly supply it. Instead the
 *                 gap reaches calculateTds, which reports pending_configuration
 *                 naming the key, and the run stops rather than under-deducting.
 *
 * Exported so this rule is testable directly. It was previously inline, where a
 * test could only restate it and would not notice the call site changing.
 */
export async function resolveStatutoryConfigForRun(period: string): Promise<StatutoryConfigMap> {
  const resolved = await getStatutoryConfigForPeriod(period);
  return resolved.source === "versioned"
    ? resolved.values
    : await loadFlatStatutoryConfig(period);
}

/**
 * Calculate TDS under New Regime (Section 115BAC) FY 2026-27 (Budget 2025).
 * Slabs: 0-4L=0%, 4-8L=5%, 8-12L=10%, 12-16L=15%, 16-20L=20%, 20-24L=25%, 24L+=30%.
 * 87A rebate ₹12L, standard deduction ₹75K, 4% health+education cess.
 * All thresholds and rates driven from statutory_config — no hardcoded defaults.
 */
export function calculateTds(
  annualTaxableIncome: number,
  statutoryConfig: StatutoryConfigMap
): TdsResult {
  // No hardcoded fallbacks. Every rate below comes from approved configuration
  // or the computation does not happen.
  //
  // The hazard was never that the old literals were wrong — they matched the
  // Finance Act 2025 bands, which Budget 2026 left alone. It is that constants
  // go stale invisibly: after a Finance Act changes a band, code carrying `?? 5`
  // keeps deducting last year's rate and nothing reports it. Under-deduction is
  // the employer's liability, with interest under s.201(1A) (s.392 of the 2025
  // Act from 1 April 2026), so this refuses rather than guesses.
  const missing = missingTdsConfigKeys(statutoryConfig);
  if (missing.length > 0) {
    return {
      tds_annual: 0,
      tds_monthly: 0,
      effective_rate: 0,
      status: "pending_configuration",
      missing_config_keys: missing,
    };
  }

  const stdDeduction = statutoryConfig["tds_standard_deduction"];
  const rebateLimit  = statutoryConfig["tds_rebate_87a_limit"];
  const cessPct      = statutoryConfig["tds_cess_pct"];

  const taxableIncome = Math.max(0, annualTaxableIncome - stdDeduction);

  // Band boundaries are structural (Finance Act 2025, unchanged by Budget 2026);
  // the RATES are configuration and are resolved per period.
  const slabs: Array<{ from: number; to: number; rate: number }> = [
    { from: 0,       to: 400000,  rate: statutoryConfig["tds_slab_0_400000"]        / 100 },
    { from: 400001,  to: 800000,  rate: statutoryConfig["tds_slab_400001_800000"]   / 100 },
    { from: 800001,  to: 1200000, rate: statutoryConfig["tds_slab_800001_1200000"]  / 100 },
    { from: 1200001, to: 1600000, rate: statutoryConfig["tds_slab_1200001_1600000"] / 100 },
    { from: 1600001, to: 2000000, rate: statutoryConfig["tds_slab_1600001_2000000"] / 100 },
    { from: 2000001, to: 2400000, rate: statutoryConfig["tds_slab_2000001_2400000"] / 100 },
    { from: 2400001, to: Infinity, rate: statutoryConfig["tds_slab_2400001_above"]  / 100 },
  ];

  let tax = 0;
  for (const slab of slabs) {
    if (taxableIncome <= slab.from - 1) break;
    const slabMax = slab.to === Infinity ? taxableIncome : Math.min(taxableIncome, slab.to);
    const slabMin = slab.from - 1;
    tax += (slabMax - slabMin) * slab.rate;
  }

  // Section 87A rebate: nil tax if taxable income (post-standard-deduction) ≤ rebateLimit (₹12L FY2026-27)
  if (taxableIncome <= rebateLimit) {
    tax = 0;
  } else {
    // 4% health and education cess on income tax (Section 112A / Finance Act)
    tax = tax * (1 + cessPct / 100);
  }

  const tds_annual  = Math.round(tax * 100) / 100;
  const tds_monthly = Math.round((tds_annual / 12) * 100) / 100;
  const effective_rate = annualTaxableIncome > 0
    ? Math.round((tds_annual / annualTaxableIncome) * 10000) / 100
    : 0;

  return { tds_annual, tds_monthly, effective_rate, status: "computed", missing_config_keys: [] };
}

// ─── Professional Tax from Slab ───────────────────────────────────────────────

/**
 * Look up PT amount for a given state and monthly income from pt_slab_master.
 * Falls back to 200 if no matching slab is found.
 */
export async function getPtFromSlab(
  stateCode: string,
  monthlyIncome: number
): Promise<number> {
  // Case-insensitive match on state_code (abbreviation) OR state_name (full name)
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT pt_amount FROM pt_slab_master
      WHERE (LOWER(state_code) = LOWER(?) OR LOWER(state_name) = LOWER(?))
        AND is_active = 1
        AND income_from <= FLOOR(?)
        AND (income_to IS NULL OR income_to >= FLOOR(?))
      ORDER BY income_from DESC
      LIMIT 1`,
    [stateCode, stateCode, monthlyIncome, monthlyIncome]
  );
  const row = (rows as Array<{ pt_amount: number }>)[0];
  if (row) return Number(row.pt_amount);

  const [anyRows] = await db.execute<RowDataPacket[]>(
    `SELECT 1 FROM pt_slab_master
      WHERE (LOWER(state_code) = LOWER(?) OR LOWER(state_name) = LOWER(?)) AND is_active = 1
      LIMIT 1`,
    [stateCode, stateCode]
  );

  if ((anyRows as RowDataPacket[]).length === 0) {
    // No slab rows for this state. That means one of two very different things,
    // and treating them alike is how an under-deduction hides:
    //
    //   the state levies no PT   -> 0 is the correct answer. Uttar Pradesh and
    //                               Delhi are in this position and account for
    //                               831 employees.
    //   nobody configured it yet -> 0 is an under-deduction, and the shortfall
    //                               is the employer's liability. Punjab levies
    //                               PT and has no rows here.
    //
    // The table cannot tell them apart, so the exempt states are named
    // explicitly and anything else is reported as the configuration gap it is.
    if (isProfessionalTaxExempt(stateCode)) return 0;
    throw new Error(
      `Professional tax is not configured for state "${stateCode}". Add its slabs to ` +
      `pt_slab_master, or record the state as PT-exempt if it levies none. ` +
      `No amount is assumed, because zero would be an under-deduction if the state does levy PT.`,
    );
  }

  // State has slabs but the income falls below the lowest bracket → genuinely 0.
  return 0;
}

export interface CalculateResult {
  run_id: string;
  status: string;
  employees_processed: number;
  total_gross: number;
  total_deductions: number;
  total_net: number;
  /**
   * Employees excluded from this run because their Professional Tax could not be resolved —
   * their branch has no state. They produced no salary_prep_line and no PT was invented for
   * them. Present so a caller cannot mistake "not in the run" for "nothing owed": a run
   * carrying any of these is incomplete and must not be finalised or disbursed.
   */
  pt_blocked_employees: Array<{ employee_id: string; employee_code: string; reason: string }>;
  blocked_count: number;
}

interface EmployeeRow {
  employee_id: string;
  employee_code: string;
  prep_line_id?: string | null;
  ctc_annual: number;
  basic_pct: number;
  hra_pct: number;
  state_code: string | null;
  salary_start_date: string | null;
  /**
   * Resolved Last Working Day as 'YYYY-MM-DD' — see employment-end-date.ts. Replaces
   * date_of_leaving, which this query used to select and which is NULL on every row.
   */
  employment_end_date: string | null;
  date_of_birth: string | null;
  process_id: string | null;
  branch_id: string | null;
  pan_number: string | null;
}

interface AttendanceRow {
  employee_id: string;
  working_days: number;
  present_days: number;
  leave_days: number;
  lwp_days: number;
  late_marks: number;
  dialer_hours: number | null;
}

interface StatutoryRow {
  pf_employee_pct: number;
  esic_employee_pct: number;
  esic_employer_pct: number;
  esic_wage_limit: number;
  pf_wage_limit: number;
  professional_tax: number;
}

/**
 * Professional tax for one employee.
 *
 * PT is levied by the STATE. An employee whose branch has no state therefore
 * has no determinable liability, and no organisation-wide amount could be
 * correct for them.
 *
 * This previously fell back to a hardcoded 200 — a number nobody configured;
 * statutory_config has never held a professional_tax key. In the 2026-03 run
 * alone that deducted ₹200 from 172 employees whose branch had no state
 * (₹34,400), while employees in Uttar Pradesh and Delhi — states with no
 * professional tax at all — correctly paid nothing.
 *
 * Stopping and naming the branch is recoverable in a single edit. Silently
 * deducting from someone who owes nothing is not.
 *
 * Where the state IS known, getPtFromSlab resolves it, including returning 0 for
 * states that levy no PT. That path was always correct and is unchanged.
 */
export async function resolveProfessionalTax(
  employeeCode: string,
  stateCode: string | null | undefined,
  monthlyGross: number,
): Promise<number> {
  if (!stateCode) {
    throw new Error(
      `Professional tax cannot be determined for ${employeeCode}: their branch has no state set. ` +
      `PT is levied per state, so no default is applied. Set the branch's state and re-run.`,
    );
  }
  return getPtFromSlab(stateCode, monthlyGross);
}

/**
 * PF / ESIC parameters for a run, from the statutory configuration resolved for
 * its period.
 *
 * The `??` defaults are retained deliberately for PF and ESIC — unlike TDS,
 * these are single nationwide statutory rates rather than slabs that a Finance
 * Act reshapes, and production supplies every one of them from configuration, so
 * the defaults are unreachable there.
 *
 * pf_wage_limit is 999999 in production, not the ₹15,000 EPF ceiling. That is
 * deliberate: an employer may contribute PF on wages above the statutory
 * ceiling, and this one does. Do not "correct" it to 15000 — that would cut
 * every employee's PF and change take-home pay. The test pinning this exists to
 * stop exactly that.
 */
export function buildStatutoryRow(statConfig: Record<string, number>): StatutoryRow {
  return {
    pf_employee_pct:   statConfig["pf_employee_pct"]   ?? 12,
    esic_employee_pct: statConfig["esic_employee_pct"] ?? 0.75,
    esic_employer_pct: statConfig["esic_employer_pct"] ?? 3.25,
    esic_wage_limit:   statConfig["esic_wage_limit"]   ?? 21000,
    pf_wage_limit:     statConfig["pf_wage_limit"]     ?? 15000,
    // No `?? 200`. Professional tax is a state levy with no sensible
    // organisation-wide default, and statutory_config has never held this key —
    // that constant was a number nobody approved. resolveProfessionalTax stops
    // the run rather than guessing.
    professional_tax:  statConfig["professional_tax"]  ?? 0,
  };
}

/**
 * The Payroll Head's stated payable days for this employee+month, or null (migration 1653).
 *
 * Returns the paid-base substitute only — the caller still caps it at the employee's active
 * calendar days, so this can never pay for days outside the employment window.
 *
 * A missing table means migration 1653 has not run in this environment, and the correct reading
 * of that is "nobody has overridden anything" — the computed value, which is what every run
 * before this feature used. Any other error is rethrown: a payroll run that silently ignores a
 * Payroll Head's override because a query failed would pay the wrong salary while reporting
 * success, which is worse than not running at all.
 */
async function getPayableDaysOverride(employeeId: string, runMonth: string): Promise<number | null> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT payable_days
         FROM payroll_payable_days_override
        WHERE employee_id = ? AND run_month = ? AND active_status = 1
        LIMIT 1`,
      [employeeId, runMonth]
    );
    const row = rows[0] as any;
    if (!row) return null;
    const days = Number(row.payable_days);
    return Number.isFinite(days) ? days : null;
  } catch (err: any) {
    if (err?.code === 'ER_NO_SUCH_TABLE' || err?.errno === 1146) return null;
    throw err;
  }
}

export async function calculatePayrollRun(runId: string, userId: string): Promise<CalculateResult> {
  return calculatePayrollRunScoped(runId, userId);
}

export async function calculatePayrollRunScoped(
  runId: string,
  userId: string,
  options: { employeeIds?: string[] } = {},
): Promise<CalculateResult> {
  // 1. Load run
  const [runRows] = await db.execute<RowDataPacket[]>(
    "SELECT * FROM salary_prep_run WHERE id = ? LIMIT 1", [runId]
  );
  const run = (runRows as SalaryPrepRun[])[0];
  if (!run) throw new Error("Run not found");
  if (isRunClosed(run.status)) {
    throw new Error(`Cannot recalculate a ${run.status} run`);
  }
  // TDS mode: 'manual' = skip auto-TDS projection; Payroll HO uploads amounts separately.
  const tdsMode: 'auto' | 'manual' = (run as any).tds_mode ?? 'manual';

  // 2a. Statutory config in force for the month being run (for TDS slab lookups).
  //
  // Resolved for run.run_month rather than for today: recalculating an earlier
  // month must apply the rates that governed it, or a reissued payslip disagrees
  // with what was actually deducted and filed.
  //
  // statutory_config_version is authoritative where it is readable, because only
  // it can express two financial years at once and only it records approval —
  // the charter requires payable figures to rest on APPROVED effective-dated
  // configuration, and an unapproved row there is a proposal that must not reach
  // a payslip.
  //
  // Where it is not readable — migration 1030 not applied on this database — the
  // flat statutory_config is used instead. That is a deployment gap, not a
  // licence to relax: the flat loader already filters is_active and
  // effective_from, so the fallback is the same period-resolved reading payroll
  // used before versioning existed, never a hardcoded rate. Failing the run
  // outright here would break every environment where 1030 has not yet run.
  const statConfig: StatutoryConfigMap = await resolveStatutoryConfigForRun(run.run_month);

  // 2b. PF / ESIC parameters for the run. See buildStatutoryRow for why the PF
  // and ESIC defaults are kept while the professional-tax one was removed.
  const stat: StatutoryRow = buildStatutoryRow(statConfig);

  // 3. Fetch eligible employees (scoped to run's process/branch filters)
  const scopedEmployeeIds = Array.from(new Set((options.employeeIds ?? []).filter(Boolean)));
  const isTargetedRun = scopedEmployeeIds.length > 0;
  // Salary is selected by the point-in-time join below, not by active_status, so
  // recalculating an older run uses the salary that was in force during that month.
  const empConds: string[] = [];
  const empParams: unknown[] = [];

  // Only people actually employed during the run month belong in the run.
  //
  // Selection was `employment_status = 'active'` alone, with no employment window, so every
  // currently-active employee got a line in every run — including months before they were
  // hired. 86 such lines in FINALIZED 2026-04, 129 in FINALIZED 2026-03, 90 in draft
  // 2026-05. Nobody was mispaid: every one of those lines carries net_salary = 0, because
  // the employee had no attendance to be paid for. But they inflate the register and its
  // headcount, and they are indistinguishable at a glance from a real employee who was paid
  // nothing — which is a genuine and separate problem worth being able to see.
  //
  // Both bounds are inclusive so mid-month movers keep their pro-rated pay: someone joining
  // on the 20th is still in that month's run, and a leaver is paid for the days worked
  // through their Last Working Day.
  //
  // The leaver bound used to read `e.date_of_leaving IS NULL OR e.date_of_leaving >= ...`.
  // That column is NULL on all 58,840 employee rows — no write path has ever populated it — so
  // the bound was inert and the only thing excluding leavers was the employment_status filter
  // below, which asks a different question. See employment-end-date.ts for what replaced it and
  // why the end-date-NULL arm of the predicate cannot be dropped.
  empConds.push(employmentWindowPredicate());
  empParams.push(run.run_month, run.run_month);

  /*
   * Scoped runs select by cost-centre ID, from salary_prep_run_scope — the identical clause
   * runEmployeeScopeSql() applies in payroll-governance.service.ts.
   *
   * These two must stay in step. That one decides whether the run may proceed; this one decides who
   * gets paid. If they select different populations, a blocker can be cleared against one set of
   * people while a different set is paid, and nothing reports the discrepancy.
   *
   * The name-based filters below remain for the 104 legacy company runs only. They cannot be used
   * for scoped runs: branch_name is not unique in branch_master (HYDERABAD, JAIPUR, JAIPUR IDC,
   * KARNAL, MEERUT and MOHALI each name two rows), so a name filter can pay a second branch.
   */
  if (String((run as { scope_kind?: string }).scope_kind ?? "company") === "scoped") {
    empConds.push("e.cost_centre_id IN (SELECT cost_centre_id FROM salary_prep_run_scope WHERE run_id = ?)");
    empParams.push(run.id);
  } else {
    if (run.process_filter) {
      empConds.push("(pm.process_name = ? OR e.process_id IN (SELECT id FROM process_master WHERE process_name = ?))");
      empParams.push(run.process_filter, run.process_filter);
    }
    if (run.branch_filter) {
      empConds.push("e.branch_id IN (SELECT id FROM branch_master WHERE branch_name = ?)");
      empParams.push(run.branch_filter);
    }
  }
  if (isTargetedRun) {
    empConds.push(`e.id IN (${scopedEmployeeIds.map(() => "?").join(",")})`);
    empParams.push(...scopedEmployeeIds);
  }

  // Payroll Head mandatory salary/journey review gate (migration 1541). Additive
  // only: an employee with NO row in employee_payroll_head_review — every employee
  // created before this gate existed, forever — is unaffected, because NOT EXISTS
  // is vacuously true for them. Only an employee WITH a row whose status is not
  // 'approved' is excluded. No ? params added, so empParams ordering is untouched.
  // Kill switch: payroll_config_flags('payroll_head_review_gate_enabled') lets this
  // be disabled instantly, without a redeploy, if anything goes wrong.
  const [reviewGateFlagRows] = await db.execute<RowDataPacket[]>(
    `SELECT config_value FROM payroll_config_flags
      WHERE branch_id IS NULL AND process_id IS NULL
        AND config_key = 'payroll_head_review_gate_enabled' LIMIT 1`
  ).catch(() => [[]] as unknown as [RowDataPacket[]]);
  const reviewGateEnabled = !reviewGateFlagRows.length || reviewGateFlagRows[0].config_value !== 'false';
  if (reviewGateEnabled) {
    empConds.push(
      `NOT EXISTS (SELECT 1 FROM employee_payroll_head_review r
                    WHERE r.employee_id = e.id AND r.status <> 'approved')`
    );
  }

  // Salary is resolved as of the run month, not as of today.
  //
  // The join below was "ON esa.employee_id = e.id" filtered by "esa.active_status = 1" —
  // whatever assignment is active TODAY, regardless of which month is being calculated.
  // payroll-nightly-recalc.worker.ts re-runs every open run each night, so entering a
  // salary revision silently rewrote older still-open months at the new figure.
  //
  // Selecting on effective_from rather than effective_to is deliberate: no write path has
  // ever populated effective_to (all 230 superseded rows in production have it NULL), so
  // effective_from is the only reliable record of when an assignment began.
  //
  // The COALESCE fallback is load-bearing. If every assignment for an employee begins
  // after the run month, the first arm matches nothing, and without the fallback this
  // INNER JOIN would drop that employee from the run entirely — paying them nothing,
  // which is worse than the staleness being fixed. The active row is used instead,
  // preserving the previous behaviour for that case.
  //
  // Verified against production before shipping: identical headcount vs the old query for
  // 2026-08 / 2026-07 / 2026-05 (1113 / 1113 / 912 rows), and one employee's CTC corrected
  // in months at or before 2026-04 — the defect being repaired, not a regression.
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id AS employee_id, e.employee_code,
            spl_existing.id AS prep_line_id,
            esa.ctc_annual, esa.structure_id, ss.basic_pct, ss.hra_pct,
            bm.state AS state_code,
            -- cost_centre_id is stamped onto the payroll line below. employees.cost_centre_id is
            -- current-state only, so reading it at report time lets a later transfer rewrite a
            -- closed month; captured here, at calculation, it records where the person was paid.
            e.process_id, e.branch_id, e.cost_centre_id,
            COALESCE(e.salary_start_date, e.date_of_joining) AS salary_start_date,
            -- Formatted in SQL, never handed to JS as a DATE: mysql2 returns a DATE as a
            -- host-timezone JS Date, and on a leaver bound a one-day shift is the difference
            -- between a paid and an unpaid final working day.
            ${EMPLOYMENT_END_DATE_SELECT} AS employment_end_date,
            e.date_of_birth,
            -- Deliberately reads the plaintext column, not pan_number_encrypted, unlike the
            -- API-response read sites elsewhere in this module. This value never leaves the
            -- server — it is only compared against PLACEHOLDER_PANS below to decide whether
            -- TDS should be skipped, never serialized to any response — and the 2026-08-10
            -- backfill wrote ciphertext that matches plaintext exactly, so switching this one
            -- read to decrypt-then-compare would add a failure mode (decrypt error → wrong
            -- guard result → wrong TDS) to real tax calculation logic for no PII-exposure
            -- benefit. Left as-is on purpose; revisit only if the plaintext column is ever
            -- dropped or diverges from ciphertext.
            TRIM(COALESCE(e.pan_number, '')) AS pan_number
       FROM employees e
       -- Point-in-time salary selection. See the block comment above this query for why
       -- this is not a join on employee_id plus active_status, and why the COALESCE
       -- fallback must stay.
       JOIN employee_salary_assignment esa ON esa.id = COALESCE(
            (SELECT p.id
               FROM employee_salary_assignment p
              WHERE p.employee_id = e.id
                AND p.effective_from <= LAST_DAY(CONCAT(?, '-01'))
              ORDER BY p.effective_from DESC, p.active_status DESC, p.created_at DESC
              LIMIT 1),
            (SELECT a.id
               FROM employee_salary_assignment a
              WHERE a.employee_id = e.id AND a.active_status = 1
              ORDER BY a.effective_from DESC, a.created_at DESC
              LIMIT 1))
       JOIN salary_structure_master ss      ON ss.id = esa.structure_id
       LEFT JOIN process_master pm          ON pm.id = e.process_id
       LEFT JOIN branch_master bm           ON bm.id = e.branch_id
       LEFT JOIN salary_prep_line spl_existing
              ON spl_existing.run_id = ? AND spl_existing.employee_id = e.id
      -- No standalone employment_status filter. It is folded into the window predicate above,
      -- where it applies ONLY to employees with no resolvable end date. Filtering on it here as
      -- well would re-exclude exactly the mid-month leavers this change exists to include.
      WHERE ${empConds.join(" AND ")}`,
    // run_month feeds the point-in-time salary join, which appears before the
    // spl_existing join in the statement, so it binds first.
    [run.run_month, runId, ...empParams]
  );
  const employees = empRows as EmployeeRow[];

  // Reconcile salary_prep_line against the current eligible population on a full
  // (non-targeted) recalculation. Nothing before this ever removed a line: an
  // employee who qualified under an older/buggy employmentWindowPredicate() but no
  // longer qualifies just keeps their stale row forever, because the write loop
  // below only INSERT ... ON DUPLICATE KEY UPDATEs employees it currently selects —
  // it never visits, and so never corrects or removes, anyone it no longer selects.
  // Confirmed live: 118 lines for already-exited employees survived the 2026-08-16
  // selection fix in the 2026-07 run for exactly this reason (none double-paid —
  // zero have a matching full_final_calculation row — but an undisbursed run would
  // pay them through ordinary payroll if left as-is). Scoped recalculations
  // (options.employeeIds set) intentionally leave every other employee's line
  // untouched, so this only runs on a full recalc, and isRunClosed() above already
  // refuses locked/disbursed/finalized runs before this line is ever reached.
  if (!isTargetedRun) {
    const currentIds = employees.map((e) => e.employee_id);
    const [staleRows] = await db.execute<RowDataPacket[]>(
      `SELECT spl.id, spl.employee_id, sp.acknowledged_at
         FROM salary_prep_line spl
         LEFT JOIN salary_payslip sp ON sp.prep_line_id = spl.id
        WHERE spl.run_id = ?
          ${currentIds.length ? `AND spl.employee_id NOT IN (${currentIds.map(() => "?").join(",")})` : ""}`,
      currentIds.length ? [runId, ...currentIds] : [runId]
    );
    const stale = staleRows as Array<{ id: string; employee_id: string; acknowledged_at: string | null }>;
    const deletable = stale.filter((r) => !r.acknowledged_at);
    const acknowledgedButStale = stale.filter((r) => r.acknowledged_at);
    if (acknowledgedButStale.length) {
      // A payslip already exists and was acknowledged by someone who no longer
      // belongs in this run. salary_payslip cascade-deletes with its line
      // (007_payroll.sql), so removing the line would silently destroy a record
      // the employee has already seen — left in place deliberately, needs a human
      // decision rather than a cascade delete.
      logger.warn(
        `[payroll] run ${runId}: ${acknowledgedButStale.length} employee(s) no longer eligible ` +
        `have an ACKNOWLEDGED payslip on this run — not purged, needs manual review: ` +
        acknowledgedButStale.map((r) => r.employee_id).join(", ")
      );
    }
    if (deletable.length) {
      // salary_prep_line_component cascades with the line (137_schema_gaps.sql).
      await db.execute(
        `DELETE FROM salary_prep_line WHERE id IN (${deletable.map(() => "?").join(",")})`,
        deletable.map((r) => r.id)
      );
      logger.info(`[payroll] run ${runId}: purged ${deletable.length} stale line(s) for employees no longer eligible`);
    }
  }

  // 4. Derive working days from run_month (Mon–Sat = 26 assumed; real impl queries holidays)
  const [year, month] = run.run_month.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const defaultWorkingDays = Number(await getPolicyValue("payroll", "calculation", "default_working_days", "26"));

  // Derive financial year string e.g. "2025-26" for months April–March
  const fyStartYear = month >= 4 ? year : year - 1;
  const financialYear = `${fyStartYear}-${String(fyStartYear + 1).slice(2)}`;

  let totalGross = 0;
  let totalDed = 0;
  let totalNet = 0;
  let processedCount = 0;

  // Fetch employees on approved/active maternity leave covering this pay month.
  // Per MBA 1961 s.5(1) these employees receive full pay — no LWP deduction.
  const maternityExemptIds = await maternityService.getActiveEmployeeIdsForMonth(run.run_month);

  // G11: Payroll gate — if feature flag is on, build set of employee IDs that have
  // unresolved mismatch or missing_punch records for the payroll month.
  const payrollLockOnUnresolved = await (async () => {
    try {
      const [flagRows] = await db.execute<RowDataPacket[]>(
        `SELECT config_value FROM attendance_feature_config
         WHERE config_key = 'payroll_lock_on_unresolved_mismatch' LIMIT 1`
      );
      return ((flagRows[0] as any)?.config_value ?? '0') === '1';
    } catch { return false; }
  })();

  const blockedEmployeeIds = new Set<string>();
  if (payrollLockOnUnresolved) {
    const monthStart = `${run.run_month}-01`;
    const [y, m] = run.run_month.split('-').map(Number);
    const di = new Date(y, m, 0).getDate();
    const monthEnd = `${run.run_month}-${String(di).padStart(2, '0')}`;
    const [blockedRows] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT employee_id FROM attendance_daily_record
       WHERE record_date BETWEEN ? AND ?
         AND (
           (mismatch_flag = 1 AND mismatch_resolved_at IS NULL)
           OR attendance_status = 'missing_punch'
         )`,
      [monthStart, monthEnd]
    );
    for (const r of blockedRows as RowDataPacket[]) {
      blockedEmployeeIds.add((r as any).employee_id as string);
    }
  }

  // All DB writes go through a single connection wrapped in a transaction so
  // that a crash mid-loop leaves the run fully rolled back rather than partially written.
  const conn = await db.getConnection();
  await conn.beginTransaction();

  // Batch write accumulators — populated during the calculation loop, flushed after it.
  // Only writes that are never read back within the same employee iteration are safe to batch.
  const batchPrepLines:    unknown[][] = [];
  const batchComponents:   unknown[][] = [];
  const batchAdvUpdates:   { id: string; newRecovered: number; newStatus: string }[] = [];
  const batchAuditRows:    unknown[][] = [];

  /**
   * Employees this run could not compute Professional Tax for.
   *
   * Owner ruling 2026-08-16 (decision 9). resolveProfessionalTax throws when the employee's
   * branch has no state, which is correct — PT is levied per state and inventing a default
   * silently deducts from someone who may owe nothing. But that throw sat inside this
   * per-employee loop while the try/rollback sits outside it, so ONE unresolvable employee
   * abandoned the entire run for everybody.
   *
   * Verified live 2026-08-16: three active employees have no branch at all — MAS63079,
   * MAS63080 and MAS63084, all joined 2026-06-30. On the first launch run they would have
   * rolled back all ~1,324 lines. It has not fired yet only because no 2026-08 run exists and
   * the nightly worker touches the current month only.
   *
   * So: no PT is invented, the employee gets no line, the engine continues for everyone else,
   * and the affected employees are named in the result so nobody is silently omitted.
   */
  const ptBlockedEmployees: Array<{ employee_id: string; employee_code: string; reason: string }> = [];

  try {
  for (const emp of employees) {
    const monthStart = `${run.run_month}-01`;
    const monthEnd   = `${run.run_month}-${String(daysInMonth).padStart(2, "0")}`;

    // G11: Skip employees with unresolved attendance issues when payroll gate is enabled
    if (blockedEmployeeIds.has(emp.employee_id)) {
      continue;
    }

    // salary_start_date gate: skip employees whose salary hasn't started yet this month
    if (emp.salary_start_date) {
      const ssd = new Date(emp.salary_start_date);
      const monthEndDate = new Date(monthEnd);
      if (ssd > monthEndDate) {
        // Still in unpaid training — no payroll entry this month
        continue;
      }
    }
    processedCount++;

    // Step 1: Load designation and department to determine attendance source
    // Use conn (transaction connection) for all reads inside the loop to ensure
    // a consistent snapshot and avoid dirty reads from concurrent payroll runs.
    const [desigRows] = await conn.execute<RowDataPacket[]>(
      `SELECT dm.designation_name, dept.dept_name
       FROM employees e
       LEFT JOIN designation_master dm ON dm.id = e.designation_id
       LEFT JOIN department_master dept ON dept.id = e.department_id
       WHERE e.id = ? LIMIT 1`,
      [emp.employee_id]
    );
    const desig = (desigRows[0] as any) ?? {};
    const isOpsExecutive =
      /executive/i.test(desig.designation_name ?? '') &&
      /operations/i.test(desig.dept_name ?? '');

    // Check if attendance_daily_record has been populated for this employee+month.
    // record_date is stored as UTC datetime; compare in IST (+05:30) to avoid off-by-one on month boundaries.
    const [adrCountRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM attendance_daily_record
       WHERE employee_id = ?
         AND DATE(CONVERT_TZ(record_date, '+00:00', '+05:30')) BETWEEN ? AND ?`,
      [emp.employee_id, monthStart, monthEnd]
    );
    const hasEngineData = Number((adrCountRows[0] as any).cnt ?? 0) > 0;

    let att: AttendanceRow;

    if (hasEngineData) {
      // Use attendance_daily_record — role-aware (dialler/biometric) with half-days, leaves, holidays
      const [attRows] = await db.execute<RowDataPacket[]>(
        `SELECT
           ? AS employee_id,
           (SELECT COUNT(*) FROM attendance_daily_record
            WHERE employee_id = ?
              AND DATE(CONVERT_TZ(record_date, '+00:00', '+05:30')) BETWEEN ? AND ?
              AND attendance_status NOT IN ('week_off','holiday')) AS working_days,
           COUNT(CASE WHEN adr.attendance_status = 'present'        THEN 1 END) AS present_days,
           COUNT(CASE WHEN adr.attendance_status = 'leave_approved' THEN 1 END) AS leave_days,
           COALESCE(SUM(adr.lwp_value), 0)                                       AS lwp_days,
           COALESCE(SUM(adr.late_mark), 0)                                       AS late_marks,
           COALESCE(SUM(CASE WHEN adr.attendance_source = 'dialler'
                              THEN adr.raw_minutes / 60.0 END), NULL)            AS dialer_hours
         FROM attendance_daily_record adr
         WHERE adr.employee_id = ?
           AND DATE(CONVERT_TZ(adr.record_date, '+00:00', '+05:30')) BETWEEN ? AND ?`,
        [emp.employee_id, emp.employee_id, monthStart, monthEnd, emp.employee_id, monthStart, monthEnd]
      );
      att = (attRows as AttendanceRow[])[0] ?? {
        employee_id: emp.employee_id,
        working_days: defaultWorkingDays,
        present_days: defaultWorkingDays,
        leave_days: 0,
        lwp_days: 0,
        late_marks: 0,
        dialer_hours: null,
      };
    } else {
      // Fallback: legacy session-count query (no attendance engine data yet)
      const [attRows] = await db.execute<RowDataPacket[]>(
        `SELECT
           ? AS employee_id,
           ? AS working_days,
           COUNT(CASE WHEN s.current_status IN ('Logged Out','Logged In') THEN 1 END) AS present_days,
           0 AS leave_days,
           (? - COUNT(CASE WHEN s.current_status IN ('Logged Out','Logged In') THEN 1 END)) AS lwp_days,
           0 AS late_marks,
           NULL AS dialer_hours
         FROM wfm_attendance_session s
         WHERE s.employee_id = ? AND s.session_date BETWEEN ? AND ?`,
        [emp.employee_id, defaultWorkingDays, defaultWorkingDays, emp.employee_id, monthStart, monthEnd]
      );
      att = (attRows as AttendanceRow[])[0] ?? {
        employee_id: emp.employee_id,
        working_days: defaultWorkingDays,
        present_days: defaultWorkingDays,
        leave_days: 0,
        lwp_days: 0,
        late_marks: 0,
        dialer_hours: null,
      };
    }

    // Step 2: Paid base calculation
    // present(1) + half_day(0.5) + all approved leave types(1 each)
    // Use attendance_daily_record which already has status per day
    const [paidBaseRows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COALESCE(SUM(
           CASE
             WHEN adr.attendance_status = 'present'         THEN 1.0
             WHEN adr.attendance_status = 'late'            THEN 1.0
             WHEN adr.attendance_status = 'half_day'        THEN 0.5
             WHEN adr.attendance_status = 'leave_approved'  THEN 1.0
             ELSE 0
           END
         ), 0) AS paid_base
       FROM attendance_daily_record adr
       WHERE adr.employee_id = ?
         AND DATE(CONVERT_TZ(adr.record_date, '+00:00', '+05:30')) BETWEEN ? AND ?`,
      [emp.employee_id, monthStart, monthEnd]
    );
    let paidBase = Number((paidBaseRows[0] as any)?.paid_base ?? 0);
    // Fallback when attendance engine has no data yet
    if (!hasEngineData) paidBase = att.present_days + att.leave_days;

    // Step 4: Week-off eligibility and holiday resolution
    //
    // Holidays are resolved BEFORE the week-off calculation because the eligibility test needs
    // them: a company holiday is not a day the employee could have worked, so it must not count
    // against "did you work every available working day". This used to be resolved further down,
    // after the week-off call, which is why the test could never see it.
    const { eligibleHolidayCount } = await resolveHolidaysForEmployeeV2(emp.employee_id, run.run_month);
    const eligibleWeekoffs = await calculateWeekoffEligibility(
      emp.employee_id, paidBase, run.run_month, eligibleHolidayCount
    );

    // Check if auto-generation of holiday work payouts is enabled
    let holidayWorkExtraPayout = 0;
    const autoGenEnabled = await isHolidayWorkAutoGenEnabled(emp.process_id, emp.branch_id);

    if (autoGenEnabled) {
      // Auto-detect and calculate holiday work payouts
      const autoResult = await detectAndCalculateHolidayWork(emp.employee_id, run.run_month);
      holidayWorkExtraPayout = autoResult.payout;

      // Audit log each auto-generated payout
      for (const hw of autoResult.holidaysWorked) {
        await conn.execute(
          `INSERT INTO holiday_work_auto_log (
             id, employee_id, run_month, holiday_id, holiday_date,
             worked_minutes, payout_unit, payout_amount, policy_id,
             created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            randomUUID(),
            emp.employee_id,
            run.run_month,
            hw.holiday_id,
            hw.holiday_date,
            hw.worked_minutes,
            hw.payout_unit,
            hw.payout_amount,
            hw.policy_id,
          ]
        );
      }
    } else {
      // Legacy: use manual request system
      const legacyResult = await resolveHolidaysForEmployeeV2(emp.employee_id, run.run_month);
      holidayWorkExtraPayout = legacyResult.holidayWorkExtraPayout;
    }

    // Step 5: Leave reversal
    const reversalResult = await checkAndReverseLeave({
      employeeId: emp.employee_id,
      runId,
      runMonth: run.run_month,
      paidBase,
      eligibleWeekoffs,
      eligibleHolidays: eligibleHolidayCount,
      daysInMonth,
    });
    // Use the (possibly reduced) paid base after reversal
    const effectivePaidBase = reversalResult.newPaidBase;
    // Recalculate week-offs and holidays with new paid base if reversal happened
    const finalWeekoffs = reversalResult.reversed
      ? await calculateWeekoffEligibility(
          emp.employee_id, effectivePaidBase, run.run_month, eligibleHolidayCount
        )
      : eligibleWeekoffs;
    const finalHolidays = reversalResult.reversed ? eligibleHolidayCount : eligibleHolidayCount;

    // Step 6: Payable days with cap
    // active_calendar_days: the employee's actual employment window this month
    // (mid-month joiners and leavers). This used to be computed only for
    // display (active_calendar_days) while finalPayableDays capped at the full
    // daysInMonth instead — so a mid-month joiner/leaver could be paid against
    // a longer window than they were actually active for. The running-salary
    // estimate always capped at active days; this aligns the locked run to
    // the same rule (Finance decision: align locked run to active-days cap).
    const calculatedPayable = effectivePaidBase + finalWeekoffs + finalHolidays;
    const activeCals = (() => {
      const effectiveStart = emp.salary_start_date && emp.salary_start_date > monthStart
        ? emp.salary_start_date : monthStart;
      // Prorated through the resolved Last Working Day, not through date_of_leaving — which
      // is NULL on every row, so this bound never once fired and every leaver was measured to
      // month end. Same resolver as the selection predicate, so a leaver cannot be selected on
      // one definition and paid on another.
      const effectiveEnd = payableThrough(emp.employment_end_date, monthEnd);
      const days = Math.round(
        (new Date(effectiveEnd).getTime() - new Date(effectiveStart).getTime()) / 86400000
      ) + 1;
      return Math.max(1, Math.min(days, daysInMonth));
    })();
    // Payroll Head month-level payable-days override (migration 1653).
    //
    // Replaces the COMPUTED term only. The active-calendar cap below is re-applied on top and is
    // not overridable: a typed 45 in a 30-day month, or a full month for someone who joined on
    // the 20th, still pays only the days the employee was actually employed. Everything after
    // this line — proration, statutory, payslip — is unchanged. Deliberately no new column on
    // salary_prep_line: the fact that a month was overridden, by whom and why, lives in
    // payroll_payable_days_override and sensitive_action_log, and the screen reads it from there.
    // Keeping this file's footprint to one lookup and one MIN() is the point.
    const payableDaysOverride = await getPayableDaysOverride(emp.employee_id, run.run_month);
    const basePayableDays = payableDaysOverride ?? calculatedPayable;
    const finalPayableDays = Math.min(basePayableDays, activeCals);

    // Step 7: Read salary — prefer salary_component_assignments (direct assignment),
    // fall back to salary_structure_component via structure_id.
    // Use conn so reads are within the transaction snapshot.
    const [scaRows] = await conn.execute<RowDataPacket[]>(
      `SELECT basic, hra, conveyance, special_allowance,
              bonus, portfolio, medical_allowance, lta, other_allowance, pli, gross
         FROM salary_component_assignments
        WHERE employee_id = ? AND status = 'active'
        ORDER BY effective_date DESC LIMIT 1`,
      [emp.employee_id],
    );
    const scaRow = (scaRows as any[])[0];

    const [compRows] = await conn.execute<RowDataPacket[]>(
      `SELECT scm.component_code, ssc.calc_type, ssc.value
         FROM salary_structure_component ssc
         JOIN salary_component_master scm ON scm.id = ssc.component_id
        WHERE ssc.structure_id = ?
        ORDER BY ssc.sequence`,
      [(emp as any).structure_id],
    );
    const compAmounts: Record<string, number> = {};
    for (const c of compRows as any[]) {
      if (c.calc_type === 'fixed' || c.calc_type === 'pct_of_ctc') {
        compAmounts[c.component_code] = Number(c.value) || 0;
      }
    }

    let hasFixedComponents: boolean;
    let fixedBasic: number;
    let fixedHRA: number;
    let fixedGross: number;
    // True when the per-employee assignment (salary_component_assignments) is
    // authoritative for this line, rather than the structure template.
    let usedScaRowAssignment = false;

    if (scaRow && Number(scaRow.gross) > 0) {
      hasFixedComponents = true;
      usedScaRowAssignment = true;
      fixedBasic = Number(scaRow.basic) || 0;
      fixedHRA   = Number(scaRow.hra)   || 0;
      fixedGross = Number(scaRow.gross);
      // Root-caused 2026-08-13 (PAYSLIP_COMPONENT_TOTAL_MISMATCH): compAmounts
      // was pre-populated above from the structure TEMPLATE (compRows), which
      // can define codes this per-employee assignment knows nothing about —
      // BONUS, PORTFOLIO, MEDICAL, LTA, OTHER_ALLOW, PLI. Overlaying the four
      // scaRow fields onto that dictionary left those leftover template values
      // in place, so they were written as extra payslip earning components with
      // no corresponding contribution to fixedGross/gross_salary (confirmed:
      // MAS00175, Portfolio Allowance ₹11,612.90 double-counted). Reset rather
      // than overlay, so nothing the template alone defined can survive into
      // this employee's payslip.
      for (const key of Object.keys(compAmounts)) delete compAmounts[key];
      compAmounts.BASIC        = fixedBasic;
      compAmounts.HRA          = fixedHRA;
      compAmounts.CONV         = Number(scaRow.conveyance)        || 0;
      compAmounts.BONUS        = Number(scaRow.bonus)             || 0;
      compAmounts.PORTFOLIO    = Number(scaRow.portfolio)         || 0;
      compAmounts.MEDICAL      = Number(scaRow.medical_allowance) || 0;
      compAmounts.LTA          = Number(scaRow.lta)               || 0;
      compAmounts.OTHER_ALLOW  = Number(scaRow.other_allowance)   || 0;
      compAmounts.PLI          = Number(scaRow.pli)               || 0;
      // SPECIAL comes from the assignment too, like every other component.
      //
      // It used to be excluded here and rebuilt downstream as a residual, because the
      // stored special_allowance was not trustworthy: MAS63025 held 0 while Rs 547.83 of
      // real gross existed. That was true of the DATA, not the design.
      //
      // salary_component_assignments is now rebuilt from db_bill and holds the identity
      // exactly - Gross = Basic + HRA + Bonus + Conv + Portfolio + MedicalAllowance + LTA
      // + SpecialAllowance + OtherAllowance on 1,080 of 1,080 active packages, 0 drift on
      // all ten columns - and db_bill computes SpecialAllowance1 as
      // ROUND(SpecialAllowance * EarnedDays / WorkingDays) directly.
      //
      // Deriving it instead compounded the rounding of three or more already-rounded terms
      // and landed +/-Rs 1 off db_bill on 57 of 1,371 July lines.
      compAmounts.SPECIAL      = Number(scaRow.special_allowance)  || 0;
      // SPECIAL is deliberately NOT set from scaRow.special_allowance here —
      // that stored value is static and can drift from the residual
      // calculateNetSalary actually computes and gross_salary is built from
      // (confirmed: MAS63025, ₹547.83 of real gross with no component at all,
      // because special_allowance was stale-stored as 0 while the true
      // residual was positive). It is written from calc.special_allowance
      // instead, once that residual is known — see the payslip-component block.
    } else {
      hasFixedComponents = compAmounts.BASIC !== undefined && compAmounts.BASIC > 0;
      fixedBasic = compAmounts.BASIC || 0;
      fixedHRA   = compAmounts.HRA   || 0;
      fixedGross = hasFixedComponents
        ? (fixedBasic + fixedHRA + (compAmounts.BONUS || 0) + (compAmounts.CONV || 0) +
           (compAmounts.PORTFOLIO || 0) + (compAmounts.MEDICAL || 0) + (compAmounts.LTA || 0) +
           (compAmounts.SPECIAL || 0) + (compAmounts.OTHER_ALLOW || 0) + (compAmounts.PLI || 0))
        : 0;
    }
    const monthlyGrossBase = hasFixedComponents ? fixedGross : (emp.ctc_annual / 12);

    // Days-based gross calculation
    const isOnMaternityLeave = maternityExemptIds.has(emp.employee_id);
    // Maternity employees receive full monthly gross (MBA 1961 s.5(1))
    const grossMonthly = isOnMaternityLeave
      ? monthlyGrossBase
      : monthlyGrossBase * (finalPayableDays / daysInMonth);
    // No separate LWP deduction needed — absent days just reduce finalPayableDays
    const lwpDeduction = 0;  // absorbed into days-based calculation
    const grossAfterLwp = grossMonthly;

    // G6/G13: Check attendance_billing_config — if extra_day_salary_allowed=0 for this
    // employee/designation/branch/process, cap payable days to calendar month days.
    // Scope precedence: employee > designation > branch > process > global.
    const billingAllowed = await (async () => {
      try {
        const [bRows] = await db.execute<RowDataPacket[]>(
          `SELECT extra_day_salary_allowed FROM attendance_billing_config
           WHERE active_status = 1
             AND (effective_from <= ? OR effective_from IS NULL)
             AND (effective_to IS NULL OR effective_to >= ?)
             AND (
               (scope_type = 'employee'     AND employee_id    = ?) OR
               (scope_type = 'designation'  AND designation_id = (SELECT designation_id FROM employees WHERE id = ? LIMIT 1)) OR
               (scope_type = 'branch'       AND branch_id      = (SELECT branch_id      FROM employees WHERE id = ? LIMIT 1)) OR
               (scope_type = 'process'      AND process_id     = (SELECT process_id     FROM employees WHERE id = ? LIMIT 1)) OR
               (scope_type = 'global'       AND employee_id IS NULL AND designation_id IS NULL
                                            AND branch_id IS NULL   AND process_id IS NULL)
             )
           ORDER BY
             CASE scope_type
               WHEN 'employee'    THEN 1
               WHEN 'designation' THEN 2
               WHEN 'branch'      THEN 3
               WHEN 'process'     THEN 4
               ELSE 5
             END
           LIMIT 1`,
          [monthStart, monthEnd, emp.employee_id, emp.employee_id, emp.employee_id, emp.employee_id]
        );
        if (!(bRows as RowDataPacket[]).length) return true;
        return Number((bRows[0] as any).extra_day_salary_allowed) === 1;
      } catch { return true; }
    })();

    // If billing not allowed and payable days would exceed calendar days, cap it
    const effectiveWorkingDays = (!billingAllowed && att.working_days > daysInMonth)
      ? daysInMonth
      : att.working_days;

    // 5a. Fetch tax declaration for this employee / financial year
    const [declRows] = await conn.execute<RowDataPacket[]>(
      "SELECT declared_hra, declared_80c, declared_80d, regime FROM tax_declaration WHERE employee_id = ? AND financial_year = ? LIMIT 1",
      [emp.employee_id, financialYear]
    );
    const decl = (declRows as TaxDeclarationRow[])[0] ?? null;

    // 5b. Employee age — used for 80D senior citizen cap (Section 80D: ₹50K if age ≥ 60)
    let employeeAge: number | null = null;
    if (emp.date_of_birth) {
      const dob = new Date(emp.date_of_birth);
      const runDate = new Date(year, month - 1, 1);
      employeeAge = runDate.getFullYear() - dob.getFullYear() -
        (runDate < new Date(runDate.getFullYear(), dob.getMonth(), dob.getDate()) ? 1 : 0);
    }

    // 5c. TDS: skip auto-projection when run is in manual TDS mode.
    // In manual mode, Payroll HO uploads per-employee TDS via POST /runs/:id/manual-tds.
    // Those amounts are applied in a post-calculation pass (see applyManualTds below).
    let tdsMonthly = 0;

    // Placeholder PAN guard — these strings are submission proxies, not real PANs.
    // Treating them as valid would compute and deduct TDS that cannot be remitted
    // to the income-tax portal, creating a recoverable shortfall at year-end.
    const PLACEHOLDER_PANS = new Set([
      "PANNOTAVBL", "PANAPPLIED", "PANINVALID", "PANANONYMOUS",
      "PANPENDING", "NOTAVAILABLE", "NOTAPPLICABLE", "NA", "N/A",
    ]);
    const empPan = (emp.pan_number as string | null | undefined)?.trim().toUpperCase() ?? "";
    const hasMissingOrPlaceholderPan = !empPan || PLACEHOLDER_PANS.has(empPan);
    let panAuditWarning: string | null = null;
    if (hasMissingOrPlaceholderPan) {
      tdsMonthly = 0;
      panAuditWarning = empPan
        ? `TDS_SKIPPED_PLACEHOLDER_PAN: "${empPan}" is a placeholder; TDS forced to 0.`
        : "TDS_SKIPPED_NO_PAN: no PAN recorded; TDS forced to 0.";
    }

    if (!hasMissingOrPlaceholderPan && tdsMode === 'auto') {
      // monthsRemaining: months left in FY from this run month (April=start, March=end)
      // e.g. run_month April(4) → 12 months; October(10) → 6 months; March(3) → 1 month
      const fyEndMonth = 3; // March
      const fyEndYear  = month <= 3 ? year : year + 1;
      const runDate    = new Date(year, month - 1, 1);
      const fyEndDate  = new Date(fyEndYear, fyEndMonth - 1, 1);
      const diffMs     = fyEndDate.getTime() - runDate.getTime();
      const monthsRemaining = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24 * 30.4375)));

      // FY-accurate annual gross: use actual paid months so far + projected remaining.
      // This handles mid-FY joiners correctly (new-regime joiner in Oct → 6 months, not 12).
      const fyStartPeriod = `${fyStartYear}-04`;
      const [ytdRows] = await conn.execute<RowDataPacket[]>(
        `SELECT COALESCE(SUM(spl.gross_salary), 0) AS already_earned,
                COALESCE(SUM(spl.tds), 0)          AS already_deducted
           FROM salary_prep_line spl
           JOIN salary_prep_run spr ON spr.id = spl.run_id
          WHERE spl.employee_id = ?
            AND spr.run_month >= ?
            AND spr.run_month < ?
            AND spr.status IN ('approved', 'finalized')`,
        [emp.employee_id, fyStartPeriod, run.run_month]
      );
      const alreadyEarned   = Number(ytdRows[0]?.already_earned   ?? 0);
      const alreadyDeducted = Number(ytdRows[0]?.already_deducted ?? 0);
      // annualGross = paid so far this FY + current month × remaining months
      const fyAnnualGross = alreadyEarned + (grossAfterLwp * monthsRemaining);

      // Age at run month — needed for 80D senior citizen cap (≥60 → ₹50K)
      let employeeAge: number | null = null;
      if (emp.date_of_birth) {
        const dob = new Date(emp.date_of_birth);
        const ref = new Date(year, month - 1, 1);
        let age = ref.getFullYear() - dob.getFullYear();
        const mDiff = ref.getMonth() - dob.getMonth();
        if (mDiff < 0 || (mDiff === 0 && ref.getDate() < dob.getDate())) age--;
        employeeAge = age;
      }

      try {
        const tdsResult = await taxEngineService.calculateMonthlyTds({
          financialYear,
          annualGross: fyAnnualGross,
          alreadyDeducted,
          declaration: decl ? {
            regime:        decl.regime as string | null,
            declared_hra:  Number(decl.declared_hra)  || 0,
            declared_80c:  Number(decl.declared_80c)  || 0,
            declared_80d:  Number(decl.declared_80d)  || 0,
          } : null,
          monthsRemaining,
          employeeAge,
        });
        tdsMonthly = tdsResult.tds_monthly;
      } catch (err: unknown) {
        // TAX_SLABS_AMBIGUOUS (taxEngine.service.ts's getSlabs) is a refusal, not an
        // unavailability — payroll_tax_slab_master has more than one active row for the same
        // band, so summing every row would silently double-tax it. Falling back to the other
        // calculator here would defeat the entire point of that guard: the run would compute a
        // plausible, wrong TDS instead of stopping. This must propagate, not be swallowed into
        // the fallback below.
        if ((err as { code?: string } | null)?.code === "TAX_SLABS_AMBIGUOUS") {
          throw err;
        }
        // Fallback to the synchronous engine when the taxEngine tables are
        // unavailable. It reads the same approved statutory_config, so this is a
        // different route to the same rates — not a laxer one.
        const annualGross = fyAnnualGross;
        const isOldRegime = (decl?.regime ?? "new") === "old";
        const declHra = isOldRegime && decl ? Number(decl.declared_hra) : 0;
        const decl80c = isOldRegime && decl ? Math.min(Number(decl.declared_80c), 150000) : 0;
        const sec80dCap = (employeeAge != null && employeeAge >= 60) ? 50000 : 25000; // s.80D senior citizen cap
        const decl80d = isOldRegime && decl ? Math.min(Number(decl.declared_80d), sec80dCap) : 0;
        // Old-regime employees can deduct HRA/80C/80D; new-regime cannot.
        // Standard deduction is applied inside calculateTds for all regimes.
        const taxableIncome = Math.max(0, annualGross - declHra - decl80c - decl80d);
        const fallback = calculateTds(taxableIncome, statConfig);

        // Zeros here mean "no approved rate was found", not "no tax is due".
        // Deducting them would under-deduct silently, and the shortfall is the
        // employer's liability with interest — so the run stops instead, naming
        // what to fix. Previously this path applied hardcoded slabs, so a
        // taxEngine outage plus stale config produced a plausible number that
        // nobody could tell was wrong.
        if (fallback.status === "pending_configuration") {
          throw new Error(
            `TDS cannot be computed for ${financialYear}: no approved statutory configuration for ` +
            `${fallback.missing_config_keys.join(", ")}. Seed and approve these keys before running payroll ` +
            `for this period — no fallback rates are applied.`,
          );
        }
        // Distribute remaining annual liability over remaining months, netting off what was
        // already deducted earlier in the FY (handles mid-FY joiners and YTD corrections).
        tdsMonthly = Math.round(Math.max(0, fallback.tds_annual - alreadyDeducted) / monthsRemaining * 100) / 100;
      }
    }

    // 5d. Salary advance monthly recovery
    const [advRows] = await conn.execute<RowDataPacket[]>(
      `SELECT COALESCE(SUM(ROUND(amount / recovery_months, 2)), 0) AS monthly_recovery
         FROM salary_advance_log
        WHERE employee_id = ? AND status = 'active'`,
      [emp.employee_id]
    );
    const advanceRecovery = Number((advRows as Array<{ monthly_recovery: number }>)[0]?.monthly_recovery ?? 0);

    // 5e. Loan EMI recovery from employee_loans
    let loanEmi = 0;
    try {
      const monthStart = `${run.run_month.slice(0, 7)}-01`;
      const [loanRows] = await db.execute<RowDataPacket[]>(
        `SELECT COALESCE(SUM(deduction_per_month), 0) AS loan_emi
           FROM employee_loans
          WHERE employee_id = ? AND status = 'active'
            AND start_date <= ? AND (end_date IS NULL OR end_date >= ?)`,
        [emp.employee_id, monthStart, monthStart]
      );
      loanEmi = Number((loanRows as Array<{ loan_emi: number }>)[0]?.loan_emi ?? 0);
    } catch {
      // employee_loans table may not exist — non-fatal
    }

    // 5f. Approved incentives from incentive_upload_batch for the run month
    let approvedIncentives = 0;
    try {
      const runMonthPfx = run.run_month.slice(0, 7);
      const [incentiveRows] = await db.execute<RowDataPacket[]>(
        `SELECT SUM(COALESCE(iul.amount, 0)) AS total_incentives
           FROM incentive_upload_line iul
           JOIN incentive_upload_batch ibu ON ibu.id = iul.batch_id
          WHERE iul.employee_id = ?
            AND ibu.pay_month = ?
            -- 'applied' must be here, not just 'approved'. incentives.service.ts applyToRun()
            -- transitions a consumed batch to 'applied', so with the narrower filter the very
            -- next recalculation found no approved batch and wrote incentive_total = 0 —
            -- silently removing an approved incentive from an employee's pay. The two paths
            -- now agree on which batches are payable. Verified before the change:
            -- incentive_upload_batch holds 0 rows, so no current figure moves.
            AND ibu.status IN ('approved', 'applied')`,
        [emp.employee_id, runMonthPfx]
      );
      approvedIncentives = Number((incentiveRows as Array<{ total_incentives: number }>)[0]?.total_incentives ?? 0);
    } catch {
      // incentive_upload_batch / incentive_upload_line may not exist — non-fatal
    }

    // 5g. Approved reimbursement claims for the run month (added to net earnings, not gross)
    //
    // ⚠️ FIXED 2026-08-13 — this read had never worked, on any run, since it was written.
    //
    // It selected `claim_amount`, which employee_reimbursement_claim does not have; the real
    // columns are amount_claimed and amount_approved. Every execution therefore raised
    // ER_BAD_FIELD_ERROR, and the bare `catch {}` below swallowed it and left
    // approvedReimbursements at 0 — so an approved reimbursement could never reach an
    // employee's pay by this path, and nothing anywhere said so. No other writer of
    // salary_prep_line.reimbursement_total exists, which is why that column is 0.00 across all
    // 80,469 payroll lines ever written.
    //
    // amount_approved is used on its own, NOT COALESCEd to amount_claimed. If an approver
    // reduced a claim, the claimed figure is the wrong number to pay; and if amount_approved is
    // NULL the approval simply did not record an amount, which must not be silently resolved
    // into a payment. Both cases are left unpaid and surface through the
    // REIMBURSEMENT_APPROVED_NOT_SETTLED readiness check instead of being guessed at here.
    //
    // ⚠️ THIS CHANGES A MONEY PATH. employee_reimbursement_claim holds 0 rows in production, so
    // this is provably a no-op on every existing and current run — but the first approved claim
    // filed after this ships will now actually be paid, which is the intended behaviour and has
    // not previously happened. Payroll/Finance sign-off is listed for it.
    let approvedReimbursements = 0;
    try {
      const runMonthPfx = run.run_month.slice(0, 7);
      const [reimRows] = await db.execute<RowDataPacket[]>(
        `SELECT COALESCE(SUM(amount_approved), 0) AS total_reimbursements
           FROM employee_reimbursement_claim
          WHERE employee_id = ?
            AND claim_month = ?
            AND status = 'approved'
            AND amount_approved IS NOT NULL`,
        [emp.employee_id, runMonthPfx]
      );
      approvedReimbursements = Number((reimRows as Array<{ total_reimbursements: number }>)[0]?.total_reimbursements ?? 0);
    } catch (err) {
      // Still non-fatal — a missing table in an older environment must not stop payroll — but
      // never again silent. A swallowed exception here is indistinguishable from "this employee
      // had no reimbursement", and that is exactly how the defect above survived unnoticed.
      console.error(
        `[payroll-calc] reimbursement read failed for employee ${emp.employee_id} in ${run.run_month}; ` +
        `treating as 0 — any approved claim for this employee is NOT being paid: ${(err as Error).message}`,
      );
    }

    // Custom deductions from employee_deduction_entries (canteen, uniform, etc.)
    let miscDeductions = 0;
    const miscComponents: Array<{ code: string; name: string; amount: number }> = [];
    try {
      const runMonthStr = run.run_month.slice(0, 7);
      const [dedEntries] = await db.execute<RowDataPacket[]>(
        `SELECT ede.description, ede.deduction_type_code, ede.amount, ede.is_prorated,
                COALESCE(pdt.deduction_name, ede.description) AS display_name
         FROM employee_deduction_entries ede
         LEFT JOIN payroll_deduction_type pdt ON pdt.deduction_code = ede.deduction_type_code
         WHERE ede.employee_id = ?
           AND ede.status = 'active'
           AND (ede.run_month IS NULL OR ede.run_month = ?)`,
        [emp.employee_id, runMonthStr]
      );
      for (const ded of dedEntries as any[]) {
        const dedAmt = ded.is_prorated
          ? Number(ded.amount) * (finalPayableDays / Math.max(1, activeCals))
          : Number(ded.amount);
        const rounded = Math.round(dedAmt * 100) / 100;
        if (rounded <= 0) continue;
        miscDeductions += rounded;
        const typeCode = ded.deduction_type_code ?? "OTHER";
        miscComponents.push({ code: `DED_${typeCode}`, name: ded.display_name ?? ded.description, amount: rounded });
      }
    } catch {
      // employee_deduction_entries or payroll_deduction_type may not exist yet — non-fatal
    }

    // Professional tax is levied by the STATE, so an employee whose branch has
    // no state has no determinable liability — there is no organisation-wide
    // amount that could be correct. This previously fell back to a hardcoded
    // 200, which is not a configured value: statutory_config has no
    // professional_tax key at all, so that number was invented here. In the
    // 2026-03 run alone it deducted Rs 200 from 172 employees whose branch had
    // no state — Rs 34,400 — while employees in Uttar Pradesh and Delhi, states
    // with no professional tax, correctly paid nothing.
    //
    // Stopping and naming the branch is recoverable in one edit. Silently
    // deducting from someone who owes nothing is not.
    //
    // Blocked per employee, not per run. Nothing has been written for this employee yet —
    // every batch push happens further down — so skipping here leaves no partial line behind.
    let professionalTax: number;
    try {
      professionalTax = await resolveProfessionalTax(
        emp.employee_code, emp.state_code, grossAfterLwp,
      );
    } catch (err) {
      ptBlockedEmployees.push({
        employee_id: emp.employee_id,
        employee_code: emp.employee_code,
        reason: err instanceof Error ? err.message : String(err),
      });
      processedCount--; // counted at the top of the loop; this employee produced no line
      continue;
    }

    // Check for approved PF / ESI opt-outs (employee voluntary declaration approved by Payroll HO)
    const [overrideRows] = await conn.execute<RowDataPacket[]>(
      `SELECT override_type FROM employee_statutory_override
       WHERE employee_id = ? AND status = 'approved'
         AND (effective_from_month IS NULL OR effective_from_month <= ?)`,
      [emp.employee_id, run.run_month]
    );
    const pfOptOut           = (overrideRows as Array<{ override_type: string }>).some(r => r.override_type === 'pf_opt_out');
    const esicOptOutDeclared = (overrideRows as Array<{ override_type: string }>).some(r => r.override_type === 'esic_opt_out');

    // ESI Act contribution-period rule (section 2(6A) / Reg 3):
    // Once covered at the start of a contribution period (Apr-Sep or Oct-Mar),
    // an employee remains covered until that period ends — even if a mid-period
    // increment pushes their gross above the wage ceiling.
    //
    // esicOptOut and this continuity rule are NOT the same signal: opt-out means
    // "never deduct ESI regardless of gross", continuity means "deduct ESI even
    // though gross is now over the ceiling". A prior version of this block tried
    // to express continuity by setting esicOptOut = false when coverage was
    // found — which is a no-op, since esicOptOut only ever reaches this branch
    // already false (esicOptOutDeclared gates entry). The actual eligibility
    // gate in calculateNetSalary is `!esicOptOut && gross <= esicWageLimit`;
    // nothing here overrode the second half of that AND, so an employee who
    // crossed the ceiling still lost coverage the month they crossed, exactly
    // the bug the ESI Act rule above exists to prevent (delta-audit 2026-08-14,
    // P0). esicContinuityOverride is the real signal: calculateNetSalary ORs it
    // into the ceiling check, touching only employees who were covered at
    // period start and have since crossed — nobody else's deduction changes.
    //
    // The contribution-period start is the later of: the first month of the
    // current Apr-Sep / Oct-Mar window, or the employee's own first month on
    // record (they cannot be "carried over" from a period before they joined).
    const esicOptOut = esicOptOutDeclared;
    let esicContinuityOverride = false;
    if (!esicOptOutDeclared) {
      try {
        const periodStart = esiContributionPeriodStart(run.run_month);
        if (periodStart < run.run_month) {
          // Check if the employee had a salary_prep_line in an earlier month of
          // this period where gross was at or below the ESI wage limit.
          const esicWageLimit = stat.esic_wage_limit;
          const [esiPriorRows] = await db.execute<RowDataPacket[]>(
            `SELECT 1 FROM salary_prep_line spl
               JOIN salary_prep_run spr ON spr.id = spl.run_id
              WHERE spl.employee_id = ?
                AND spr.run_month >= ?
                AND spr.run_month < ?
                AND LOWER(spr.status) NOT IN ('draft', 'cancelled')
                AND spl.gross_salary > 0
                AND spl.gross_salary <= ?
              LIMIT 1`,
            [emp.employee_id, periodStart, run.run_month, esicWageLimit],
          );
          if ((esiPriorRows as any[]).length > 0) {
            // Covered at period start → must stay covered this month regardless of current gross
            esicContinuityOverride = true;
          }
        }
      } catch {
        // Non-fatal: if the check fails, fall through to the standard gross-ceiling test
      }
    }

    const effectiveBasicPct = hasFixedComponents
      ? (fixedBasic / monthlyGrossBase) * 100
      : (emp.basic_pct ?? 40);
    const effectiveHraPct = hasFixedComponents
      ? (fixedHRA / monthlyGrossBase) * 100
      : (emp.hra_pct ?? 20);

    const calc = payrollService.calculateNetSalary({
      grossMonthlyCTC: grossAfterLwp,
      workingDays: att.working_days || defaultWorkingDays,
      lwpDays: 0, // LWP already absorbed into days-based gross; pass 0 to avoid double-deduction
      pfEmployeePct: stat.pf_employee_pct,
      esicEmployeePct: stat.esic_employee_pct,
      esicEmployerPct: stat.esic_employer_pct,
      esicWageLimit: stat.esic_wage_limit,
      pfWageLimit: stat.pf_wage_limit,
      professionalTax,
      tds: tdsMonthly,
      basicPct: effectiveBasicPct,
      hraPct: effectiveHraPct,
      pfOptOut,
      esicOptOut,
      esicContinuityOverride,
      gratuityPct: statConfig["gratuity_pct"],
    });

    // Net pay = payrollService net + holiday work extra payout + incentives + reimbursements
    //           - advance recovery - loan EMI - misc deductions.
    // Incentives and reimbursements are non-gross additions; they do not affect PF/ESI/TDS base.
    const { totalDeductions: totalDedFinal, netSalary: netPayFinal } = reconcileNetAndDeductions(
      calc.gross_salary + holidayWorkExtraPayout + approvedIncentives + approvedReimbursements,
      calc.total_deductions + advanceRecovery + loanEmi + miscDeductions
    );

    // 6. Accumulate prep line for batch upsert after loop
    const prepLineId = emp.prep_line_id || randomUUID();
    batchPrepLines.push([
      prepLineId, runId, emp.employee_id, emp.employee_code,
      // Where this person was paid, frozen at calculation — see the column list below.
      emp.branch_id ?? null, emp.cost_centre_id ?? null,
      att.working_days, att.present_days, att.leave_days, att.lwp_days, att.late_marks, att.dialer_hours,
      calc.gross_salary, grossMonthly, totalDedFinal, netPayFinal,
      calc.basic, calc.hra, calc.special_allowance,
      calc.pf_employee, calc.pf_employer, calc.esic_employee, calc.esic_employer,
      calc.professional_tax, tdsMonthly, tdsMonthly, lwpDeduction, advanceRecovery,
      loanEmi,
      effectivePaidBase, finalWeekoffs, finalHolidays, finalPayableDays, activeCals, holidayWorkExtraPayout,
      miscDeductions,
      hasEngineData ? 'ADR' : 'SESSION_FALLBACK',
      approvedIncentives,
      approvedReimbursements,
      CALCULATION_ENGINE_VERSION,
      calc.gratuity ?? 0,
    ]);

    // 6b. Insert component-level breakdown for payslip display
    // Use actual fixed component amounts from salary_structure_component when available
    const payslipEarnings = buildPayslipEarningComponents({
      hasFixedComponents,
      usedScaRowAssignment,
      compAmounts,
      ratio: finalPayableDays / daysInMonth,
      ratioNumerator: finalPayableDays,
      ratioDenominator: daysInMonth,
      calcBasic: calc.basic,
      calcHra: calc.hra,
      calcSpecialAllowance: calc.special_allowance,
      convAllowanceDefault: statConfig["conv_allowance_default"],
      medicalAllowanceDefault: statConfig["medical_allowance_default"],
    });
    // 6b. Accumulate component rows for batch insert
    for (const comp of payslipEarnings) {
      if (comp.amount <= 0) continue;
      batchComponents.push([randomUUID(), runId, prepLineId, emp.employee_id, comp.code, comp.name, 'earning', comp.amount, 'structure', 1]);
    }
    // Record incentive and reimbursement as distinct earning components.
    //
    // component_type is enum('earning','deduction','employer_cost') and source is
    // enum('snapshot','structure','statutory','manual','system') on the live column.
    // These two pushes previously supplied 'reimbursement' / 'incentive_upload' /
    // 'reimbursement_claim', none of which are members. The server runs with
    // STRICT_TRANS_TABLES, so the multi-row INSERT that flushes batchComponents raised
    // a data error and rolled back the WHOLE run transaction the moment any employee in
    // the population had an approved incentive or reimbursement. Zero rows in
    // salary_prep_line_component carry source='structure' or 'statutory' today, which is
    // consistent with this batch never having landed in production.
    //
    // The provenance that mattered is already carried by component_code (INCENTIVE /
    // REIMBURSEMENT); 'manual' is the correct enum member for a human-approved intake.
    if (approvedIncentives > 0) {
      batchComponents.push([randomUUID(), runId, prepLineId, emp.employee_id, 'INCENTIVE', 'Incentive', 'earning', approvedIncentives, 'manual', 0]);
    }
    if (approvedReimbursements > 0) {
      batchComponents.push([randomUUID(), runId, prepLineId, emp.employee_id, 'REIMBURSEMENT', 'Reimbursement', 'earning', approvedReimbursements, 'manual', 0]);
    }

    const statutoryDeductions = [
      { code: "PF_EMPLOYEE",       name: "Provident Fund (Employee)",    amount: calc.pf_employee },
      { code: "ESIC_EMPLOYEE",     name: "ESI (Employee)",               amount: calc.esic_employee },
      { code: "PROFESSIONAL_TAX",  name: "Professional Tax",             amount: calc.professional_tax },
      { code: "TDS",               name: "Income Tax (TDS)",             amount: tdsMonthly },
      { code: "LWP_DEDUCTION",     name: "LWP / Leave Without Pay",      amount: lwpDeduction },
      { code: "ADVANCE_RECOVERY",  name: "Advance Recovery",             amount: advanceRecovery },
      { code: "LOAN_EMI",          name: "Loan EMI",                     amount: loanEmi },
    ];
    for (const ded of statutoryDeductions) {
      if (ded.amount <= 0) continue;
      batchComponents.push([randomUUID(), runId, prepLineId, emp.employee_id, ded.code, ded.name, 'deduction', ded.amount, 'statutory', 0]);
    }

    for (const ded of miscComponents) {
      // 'custom_deduction' is not a member of the source enum — see the note above the
      // incentive/reimbursement pushes. This has not aborted a run yet only because no
      // active employee_deduction_entries row exists; it would on the first one.
      batchComponents.push([randomUUID(), runId, prepLineId, emp.employee_id, ded.code, ded.name, 'deduction', ded.amount, 'manual', 0]);
    }

    // Step 10b: Read advance state now (needed to compute newRecovered); defer the UPDATE to batch after loop.
    if (advanceRecovery > 0) {
      const [activeAdvances] = await conn.execute<RowDataPacket[]>(
        `SELECT id, amount, recovery_months, COALESCE(recovered_amount, 0) AS recovered_amount
           FROM salary_advance_log
          WHERE employee_id = ? AND status = 'active'`,
        [emp.employee_id]
      );
      for (const adv of activeAdvances as Array<{ id: string; amount: number; recovery_months: number; recovered_amount: number }>) {
        const installment = Math.round((adv.amount / Math.max(1, adv.recovery_months)) * 100) / 100;
        const newRecovered = Math.min(Number(adv.recovered_amount) + installment, Number(adv.amount));
        const newStatus = newRecovered >= Number(adv.amount) ? "recovered" : "active";
        batchAdvUpdates.push({ id: adv.id, newRecovered, newStatus });
      }
    }

    // Step 11: Accumulate audit row for batch insert
    batchAuditRows.push([
      emp.employee_id,
      JSON.stringify({
        run_id: runId,
        attendance_source: isOpsExecutive ? 'APR/dialler' : 'biometric',
        paid_base: effectivePaidBase,
        eligible_weekoffs: finalWeekoffs,
        eligible_holidays: finalHolidays,
        calculated_payable: calculatedPayable,
        final_payable: finalPayableDays,
        leave_reversed: reversalResult.daysReversed,
        gross: grossAfterLwp,
        net: netPayFinal,
        ...(panAuditWarning ? { pan_warning: panAuditWarning } : {}),
      }),
    ]);

    totalGross += calc.gross_salary;
    totalDed   += totalDedFinal;
    totalNet   += netPayFinal;
  }

  // ── Batch flush ────────────────────────────────────────────────────────────
  // All writes accumulated during the loop are issued here in multi-row batches,
  // replacing the N individual round-trips that were in the loop body.

  // Flush salary_prep_line rows
  if (batchPrepLines.length > 0) {
    // Always delete existing component rows before re-inserting to prevent
    // duplicate accumulation across recalculations.
    // For targeted runs scope to affected employees; for full runs scope to entire run.
    if (isTargetedRun) {
      await conn.execute(
        `DELETE FROM salary_prep_line_component
          WHERE run_id = ?
            AND employee_id IN (${scopedEmployeeIds.map(() => "?").join(",")})`,
        [runId, ...scopedEmployeeIds],
      );
    } else {
      await conn.execute(
        `DELETE FROM salary_prep_line_component WHERE run_id = ?`,
        [runId],
      );
    }

    // 37 placeholders, then the literal status, then 4 more — one per column below, in order.
    // Two were added after employee_code for the branch/cost-centre stamp; the count here and the
    // column list and the row push in batchPrepLines.push() must move together or every value
    // shifts one column left and lands in the wrong field.
    const placeholders = batchPrepLines.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'calculated\', ?, ?, ?, ?)').join(',');
    await conn.execute(
      `INSERT INTO salary_prep_line
         (id, run_id, employee_id, employee_code,
          -- Where this person was paid. employees.cost_centre_id is current-state only (the
          -- effective-dated employee_cost_centre_allocation table holds 0 rows), so a register
          -- that derives it from the employee changes retroactively when somebody transfers and a
          -- paid cost centre can later read as unpaid. Frozen here instead.
          branch_id, cost_centre_id,
          working_days, present_days, leave_days, lwp_days, late_marks, dialer_hours,
          gross_salary, gross_before_lwp, total_deductions, net_salary,
          basic, hra, special_allowance,
          pf_employee, pf_employer, esic_employee, esic_employer,
          professional_tax, tds, tds_amount, lwp_deduction, advance_recovery,
          loan_emi,
          paid_working_days, eligible_weekoff_days, eligible_holiday_days,
          final_payable_days, active_calendar_days, holiday_work_extra_payout,
          other_deductions,
          attendance_data_source,
          status,
          incentive_total,
          reimbursement_total,
          calculation_version,
          gratuity)
       VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE
         -- Refreshed on recalculation: if somebody's cost centre was corrected and the run is
         -- recomputed, the line must record where they are actually paid this time, not the
         -- posting captured on the first pass.
         branch_id = VALUES(branch_id), cost_centre_id = VALUES(cost_centre_id),
         working_days = VALUES(working_days), present_days = VALUES(present_days),
         leave_days = VALUES(leave_days), lwp_days = VALUES(lwp_days),
         late_marks = VALUES(late_marks), dialer_hours = VALUES(dialer_hours),
         gross_salary = VALUES(gross_salary),
         gross_before_lwp = VALUES(gross_before_lwp),
         total_deductions = VALUES(total_deductions), net_salary = VALUES(net_salary),
         basic = VALUES(basic), hra = VALUES(hra), special_allowance = VALUES(special_allowance),
         pf_employee = VALUES(pf_employee), pf_employer = VALUES(pf_employer),
         esic_employee = VALUES(esic_employee), esic_employer = VALUES(esic_employer),
         professional_tax = VALUES(professional_tax),
         tds = VALUES(tds), tds_amount = VALUES(tds_amount),
         lwp_deduction = VALUES(lwp_deduction), advance_recovery = VALUES(advance_recovery),
         loan_emi = VALUES(loan_emi),
         paid_working_days = VALUES(paid_working_days),
         eligible_weekoff_days = VALUES(eligible_weekoff_days),
         eligible_holiday_days = VALUES(eligible_holiday_days),
         final_payable_days = VALUES(final_payable_days),
         active_calendar_days = VALUES(active_calendar_days),
         holiday_work_extra_payout = VALUES(holiday_work_extra_payout),
         other_deductions = VALUES(other_deductions),
         attendance_data_source = VALUES(attendance_data_source),
         incentive_total = VALUES(incentive_total),
         reimbursement_total = VALUES(reimbursement_total),
         calculation_version = VALUES(calculation_version),
         gratuity = VALUES(gratuity),
         status = 'calculated'`,
      batchPrepLines.flat()
    );
  }

  // Flush salary_prep_line_component rows
  if (batchComponents.length > 0) {
    const CHUNK = 200;
    for (let i = 0; i < batchComponents.length; i += CHUNK) {
      const chunk = batchComponents.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(',');
      await conn.execute(
        `INSERT INTO salary_prep_line_component
           (id, run_id, line_id, employee_id, component_code, component_name, component_type, amount, source, taxable)
         VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE amount = VALUES(amount), source = VALUES(source), taxable = VALUES(taxable)`,
        chunk.flat()
      );
    }
  }

  // Flush advance log updates
  for (const upd of batchAdvUpdates) {
    await conn.execute(
      `UPDATE salary_advance_log SET recovered_amount = ?, status = ? WHERE id = ?`,
      [upd.newRecovered, upd.newStatus, upd.id]
    );
  }

  // Flush audit rows
  if (batchAuditRows.length > 0) {
    const placeholders = batchAuditRows.map(() => `(UUID(), 'system', 'payroll-engine', 'payroll_calculation', 'payroll', 'salary_prep_line', ?, NULL, ?, '127.0.0.1', 'payroll-engine')`).join(',');
    await conn.execute(
      `INSERT INTO sensitive_action_log
         (id, actor_user_id, actor_role, action_type, module_key, entity_type, entity_id, old_value_json, new_value_json, ip_address, user_agent)
       VALUES ${placeholders}`,
      batchAuditRows.flat()
    );
  }
  // ── End batch flush ────────────────────────────────────────────────────────

  // 7a. Apply manual TDS entries (only when tds_mode = 'manual')
  // For each row in salary_run_manual_tds, SET tds to the manual amount (not additive)
  // to avoid double-deduction if mode was switched after partial auto calculation.
  if (tdsMode === 'manual') {
    const [manualTdsRows] = await db.execute<RowDataPacket[]>(
      `SELECT employee_id, tds_amount FROM salary_run_manual_tds WHERE run_id = ?`,
      [runId]
    );
    for (const row of manualTdsRows as Array<{ employee_id: string; tds_amount: number }>) {
      const tdsAmt = Number(row.tds_amount) || 0;
      // First zero out any auto-TDS already in the line, then apply the manual amount.
      // This prevents double-deduction when mode was switched after partial auto calculation.
      await conn.execute(
        `UPDATE salary_prep_line
            SET total_deductions = GREATEST(0, total_deductions - tds_amount) + ?,
                net_salary       = GREATEST(0, net_salary + tds_amount - ?),
                tds              = ?,
                tds_amount       = ?
          WHERE run_id = ? AND employee_id = ?`,
        [tdsAmt, tdsAmt, tdsAmt, tdsAmt, runId, row.employee_id]
      );
      if (tdsAmt > 0) {
        await conn.execute(
          `INSERT INTO salary_prep_line_component
             (id, run_id, line_id, employee_id, component_code, component_name, component_type, amount, source, taxable)
           SELECT UUID(), ?, spl.id, ?, 'TDS', 'Income Tax (TDS)', 'deduction', ?, 'manual', 0
             FROM salary_prep_line spl
            WHERE spl.run_id = ? AND spl.employee_id = ?
           ON DUPLICATE KEY UPDATE amount = VALUES(amount)`,
          [runId, row.employee_id, tdsAmt, runId, row.employee_id]
        );
      }
    }
    // Recalculate run totals after TDS application
    const [sumRows] = (await conn.execute(
      `SELECT COALESCE(SUM(gross_salary),0) AS tg,
              COALESCE(SUM(total_deductions),0) AS td,
              COALESCE(SUM(net_salary),0) AS tn
       FROM salary_prep_line WHERE run_id = ?`,
      [runId]
    )) as [RowDataPacket[], unknown];
    const sums = (sumRows[0] as any);
    totalGross = Number(sums.tg);
    totalDed   = Number(sums.td);
    totalNet   = Number(sums.tn);
  }

  if (isTargetedRun) {
    const [sumRows] = (await conn.execute(
      `SELECT COUNT(*) AS total_employees,
              COALESCE(SUM(gross_salary),0) AS tg,
              COALESCE(SUM(total_deductions),0) AS td,
              COALESCE(SUM(net_salary),0) AS tn
         FROM salary_prep_line WHERE run_id = ?`,
      [runId]
    )) as [RowDataPacket[], unknown];
    const sums = (sumRows[0] as any);
    processedCount = Number(sums.total_employees ?? processedCount);
    totalGross = Number(sums.tg);
    totalDed = Number(sums.td);
    totalNet = Number(sums.tn);
  }

  // 7. Update run totals + status
  //
  // Root-caused 2026-08-14: 'approved' is deliberately not in
  // CLOSED_RUN_STATUSES (run-status.ts) — an approved run can still reach
  // this UPDATE and be silently demoted back to 'processing' by a
  // recalculation. Before this fix, finance_approved_by/at,
  // ceo_acknowledged_by/at and validation_status were left untouched when
  // that happened, so a run could carry a finance/CEO/Head-Payroll signature
  // dated against figures a subsequent recalculation had since changed —
  // the signature and the numbers underneath it silently diverging with no
  // record that it happened. Recalculation itself is not blocked here (route
  // -level confirmation is a separate, softer guard in payroll.routes.ts) —
  // but every approval stamp this run carries is cleared in the same
  // statement that changes its figures, so a stale signature can never
  // describe numbers other than the ones it was actually given for.
  //
  // validation_status is cleared to 'pending', NOT to NULL. The column is
  // enum('pending','validated','rejected') NOT NULL DEFAULT 'pending', and the server runs
  // STRICT_TRANS_TABLES, so `= NULL` is a hard ER_BAD_NULL_ERROR rather than a silent coercion —
  // it aborted the whole transaction and rolled the recalculation back. Measured live 2026-08-16:
  // 793 queued recalculations failed on exactly this, every one reading "Column
  // 'validation_status' cannot be null", the moment a scheduled drainer started working the
  // backlog. The four sibling columns beside it ARE nullable, which is why only this one bit.
  // 'pending' is the enum's own "not yet validated" state, so the intent — drop the validation
  // stamp when the figures move — is unchanged.
  await conn.execute(
    `UPDATE salary_prep_run
        SET status = 'processing', total_employees = ?,
            total_gross = ?, total_deductions = ?, total_net = ?,
            payroll_model_version = ?,
            finance_approved_by = NULL, finance_approved_at = NULL, finance_remarks = NULL,
            ceo_acknowledged_by = NULL, ceo_acknowledged_at = NULL, ceo_remarks = NULL,
            validation_status = 'pending', validated_by = NULL, validated_at = NULL
      WHERE id = ?`,
    [processedCount, totalGross, totalDed, totalNet, CALCULATION_ENGINE_VERSION, runId]
  );

  await conn.commit();
  } catch (err) {
    await conn.rollback();
    // Reset run to draft so it can be retried cleanly
    try {
      await db.execute(
        // LOWER(status) because FINALIZED is stored uppercase; without it this
        // error path could demote a settled run to draft.
        `UPDATE salary_prep_run SET status = 'draft' WHERE id = ? AND LOWER(status) NOT IN (${CLOSED_RUN_STATUSES_SQL})`,
        [runId]
      );
    } catch {
      // best-effort reset; don't mask the original error
    }
    throw err;
  } finally {
    conn.release();
  }

  const [updated] = await db.execute<RowDataPacket[]>(
    "SELECT * FROM salary_prep_run WHERE id = ? LIMIT 1", [runId]
  );

  return {
    run_id: runId,
    status: (updated as SalaryPrepRun[])[0]?.status ?? "processing",
    employees_processed: processedCount,
    total_gross: totalGross,
    total_deductions: totalDed,
    total_net: totalNet,
    // Named, not swallowed. A caller that ignores this is omitting people from payroll
    // silently, which is the failure this replaced a whole-run abort to avoid.
    pt_blocked_employees: ptBlockedEmployees,
    blocked_count: ptBlockedEmployees.length,
  };
}
