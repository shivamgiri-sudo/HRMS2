import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { missingTdsConfigKeys } from "./statutory-regime.js";
// The closed-run set was `["locked", "disbursed"]`, which matched no row in
// production — runs finish as FINALIZED — so this guard never fired.
import { isRunClosed, CLOSED_RUN_STATUSES_SQL } from "./run-status.js";
import { isProfessionalTaxExempt } from "./professional-tax-states.js";
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
                          'gratuity_min_service_months','gratuity_divisor','gratuity_multiplier')
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
  const diffMs = asOfDate.getTime() - joinDate.getTime();
  const totalMonths = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 30.4375));
  const completedYears = Math.floor(totalMonths / 12);

  if (totalMonths < minMonths) {
    return { eligible: false, amount: 0, years: completedYears, reason: "below_minimum_service" };
  }

  const amount = Math.round(
    ((lastBasicMonthly / divisor) * multiplier * completedYears) * 100
  ) / 100;
  return { eligible: true, amount, years: completedYears };
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

  // Section 87A rebate: nil tax if total income ≤ rebateLimit (₹12L FY2026-27)
  if (annualTaxableIncome <= rebateLimit) {
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
        AND income_from <= ?
        AND (income_to IS NULL OR income_to >= ?)
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
  date_of_leaving: string | null;
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
  // before date_of_leaving.
  empConds.push("COALESCE(e.salary_start_date, e.date_of_joining) <= LAST_DAY(CONCAT(?, '-01'))");
  empParams.push(run.run_month);
  empConds.push("(e.date_of_leaving IS NULL OR e.date_of_leaving >= CONCAT(?, '-01'))");
  empParams.push(run.run_month);

  if (run.process_filter) {
    empConds.push("(pm.process_name = ? OR e.process_id IN (SELECT id FROM process_master WHERE process_name = ?))");
    empParams.push(run.process_filter, run.process_filter);
  }
  if (run.branch_filter) {
    empConds.push("e.branch_id IN (SELECT id FROM branch_master WHERE branch_name = ?)");
    empParams.push(run.branch_filter);
  }
  if (isTargetedRun) {
    empConds.push(`e.id IN (${scopedEmployeeIds.map(() => "?").join(",")})`);
    empParams.push(...scopedEmployeeIds);
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
            e.process_id, e.branch_id,
            COALESCE(e.salary_start_date, e.date_of_joining) AS salary_start_date,
            e.date_of_leaving,
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
      WHERE LOWER(e.employment_status) = 'active' AND ${empConds.join(" AND ")}`,
    // run_month feeds the point-in-time salary join, which appears before the
    // spl_existing join in the statement, so it binds first.
    [run.run_month, runId, ...empParams]
  );
  const employees = empRows as EmployeeRow[];

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
    const eligibleWeekoffs = await calculateWeekoffEligibility(emp.employee_id, paidBase, run.run_month);

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

    const { eligibleHolidayCount } = await resolveHolidaysForEmployeeV2(emp.employee_id, run.run_month);

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
      ? await calculateWeekoffEligibility(emp.employee_id, effectivePaidBase, run.run_month)
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
      const effectiveEnd = emp.date_of_leaving && emp.date_of_leaving < monthEnd
        ? emp.date_of_leaving : monthEnd;
      const days = Math.round(
        (new Date(effectiveEnd).getTime() - new Date(effectiveStart).getTime()) / 86400000
      ) + 1;
      return Math.max(1, Math.min(days, daysInMonth));
    })();
    const finalPayableDays = Math.min(calculatedPayable, activeCals);

    // Step 7: Read salary — prefer salary_component_assignments (direct assignment),
    // fall back to salary_structure_component via structure_id.
    // Use conn so reads are within the transaction snapshot.
    const [scaRows] = await conn.execute<RowDataPacket[]>(
      `SELECT basic, hra, conveyance, special_allowance, gross
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

    if (scaRow && Number(scaRow.gross) > 0) {
      hasFixedComponents = true;
      fixedBasic = Number(scaRow.basic) || 0;
      fixedHRA   = Number(scaRow.hra)   || 0;
      fixedGross = Number(scaRow.gross);
      // Populate compAmounts so payslip component loop works
      compAmounts.BASIC  = fixedBasic;
      compAmounts.HRA    = fixedHRA;
      compAmounts.CONV   = Number(scaRow.conveyance)        || 0;
      compAmounts.SPECIAL = Number(scaRow.special_allowance) || 0;
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

    // 5b. TDS: skip auto-projection when run is in manual TDS mode.
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

      try {
        const tdsResult = await taxEngineService.calculateMonthlyTds({
          financialYear,
          annualGross: grossAfterLwp * 12,
          declaration: decl ? {
            regime:        decl.regime as string | null,
            declared_hra:  Number(decl.declared_hra)  || 0,
            declared_80c:  Number(decl.declared_80c)  || 0,
            declared_80d:  Number(decl.declared_80d)  || 0,
          } : null,
          monthsRemaining,
        });
        tdsMonthly = tdsResult.tds_monthly;
      } catch {
        // Fallback to the synchronous engine when the taxEngine tables are
        // unavailable. It reads the same approved statutory_config, so this is a
        // different route to the same rates — not a laxer one.
        const annualGross = grossAfterLwp * 12;
        const declHra = decl ? Number(decl.declared_hra) : 0;
        const decl80c = decl ? Number(decl.declared_80c) : 0;
        const decl80d = decl ? Number(decl.declared_80d) : 0;
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
        tdsMonthly = fallback.tds_monthly;
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
            AND ibu.status = 'approved'`,
        [emp.employee_id, runMonthPfx]
      );
      approvedIncentives = Number((incentiveRows as Array<{ total_incentives: number }>)[0]?.total_incentives ?? 0);
    } catch {
      // incentive_upload_batch / incentive_upload_line may not exist — non-fatal
    }

    // 5g. Approved reimbursement claims for the run month (added to net earnings, not gross)
    let approvedReimbursements = 0;
    try {
      const runMonthPfx = run.run_month.slice(0, 7);
      const [reimRows] = await db.execute<RowDataPacket[]>(
        `SELECT SUM(COALESCE(claim_amount, 0)) AS total_reimbursements
           FROM employee_reimbursement_claim
          WHERE employee_id = ?
            AND claim_month = ?
            AND status = 'approved'`,
        [emp.employee_id, runMonthPfx]
      );
      approvedReimbursements = Number((reimRows as Array<{ total_reimbursements: number }>)[0]?.total_reimbursements ?? 0);
    } catch {
      // employee_reimbursement_claim may not exist or claim_month column may differ — non-fatal
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
    const professionalTax = await resolveProfessionalTax(
      emp.employee_code, emp.state_code, grossAfterLwp,
    );

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
    // Previous code re-evaluated gross > esic_wage_limit every month, so a raise
    // in month 3 of a 6-month period silently dropped ESI for months 3–6.
    // This check forces coverage on for those months.
    //
    // The contribution-period start is the later of: the first month of the
    // current Apr-Sep / Oct-Mar window, or the employee's own first month on
    // record (they cannot be "carried over" from a period before they joined).
    let esicOptOut = esicOptOutDeclared;
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
            esicOptOut = false;
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
    ]);

    // 6b. Insert component-level breakdown for payslip display
    // Use actual fixed component amounts from salary_structure_component when available
    const payslipEarnings: Array<{code: string; name: string; amount: number}> = [];
    if (hasFixedComponents) {
      const ratio = finalPayableDays / daysInMonth;
      const compNames: Record<string, string> = {
        BASIC: "Basic Salary", HRA: "House Rent Allowance", BONUS: "Bonus",
        CONV: "Conveyance Allowance", PORTFOLIO: "Portfolio Allowance",
        MEDICAL: "Medical Allowance", LTA: "Leave Travel Allowance",
        SPECIAL: "Special Allowance", OTHER_ALLOW: "Other Allowance", PLI: "PLI"
      };
      for (const [code, val] of Object.entries(compAmounts)) {
        if (val > 0 && compNames[code]) {
          payslipEarnings.push({ code, name: compNames[code], amount: Math.round(val * ratio * 100) / 100 });
        }
      }
    } else {
      const { conv, ma, pa } = breakSpecialAllowance(
        calc.special_allowance,
        statConfig["conv_allowance_default"],
        statConfig["medical_allowance_default"],
      );
      payslipEarnings.push(
        { code: "BASIC", name: "Basic Salary", amount: calc.basic },
        { code: "HRA", name: "House Rent Allowance", amount: calc.hra },
        { code: "CONV", name: "Conveyance Allowance", amount: conv },
        { code: "MA", name: "Medical Allowance", amount: ma },
        { code: "PA", name: "Personal Allowance", amount: pa },
      );
    }
    // 6b. Accumulate component rows for batch insert
    for (const comp of payslipEarnings) {
      if (comp.amount <= 0) continue;
      batchComponents.push([randomUUID(), runId, prepLineId, emp.employee_id, comp.code, comp.name, 'earning', comp.amount, 'structure', 1]);
    }
    // Record incentive and reimbursement as distinct earning components
    if (approvedIncentives > 0) {
      batchComponents.push([randomUUID(), runId, prepLineId, emp.employee_id, 'INCENTIVE', 'Incentive', 'earning', approvedIncentives, 'incentive_upload', 0]);
    }
    if (approvedReimbursements > 0) {
      batchComponents.push([randomUUID(), runId, prepLineId, emp.employee_id, 'REIMBURSEMENT', 'Reimbursement', 'reimbursement', approvedReimbursements, 'reimbursement_claim', 0]);
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
      batchComponents.push([randomUUID(), runId, prepLineId, emp.employee_id, ded.code, ded.name, 'deduction', ded.amount, 'custom_deduction', 0]);
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

    const placeholders = batchPrepLines.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'calculated\', ?, ?)').join(',');
    await conn.execute(
      `INSERT INTO salary_prep_line
         (id, run_id, employee_id, employee_code,
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
          reimbursement_total)
       VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE
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
  await conn.execute(
    `UPDATE salary_prep_run
        SET status = 'processing', total_employees = ?,
            total_gross = ?, total_deductions = ?, total_net = ?
      WHERE id = ?`,
    [processedCount, totalGross, totalDed, totalNet, runId]
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
  };
}
