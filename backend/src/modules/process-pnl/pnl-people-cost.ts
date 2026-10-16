/**
 * THE People Cost definition for every P&L surface (owner rule, updated 2026-10-16).
 *
 * People Cost for a month, per salary_prep_line:
 *
 *   People Cost = Disbursement basis + Employer contributions + Incentive
 *
 *   Disbursement    = adaptive basis per employee:
 *                     • IF |net_salary - gross_salary| < Rs 7,000: use net_salary
 *                       (normal months where deductions are routine — net ≈ gross)
 *                     • ELSE: use (net_salary + gross_salary) / 2
 *                       (months with large F&F recoveries or year-start TDS credits
 *                        where net diverges significantly from gross)
 *   Employer side   = COALESCE(pf_employer,0) + COALESCE(esic_employer,0) + COALESCE(gratuity,0)
 *   Incentive       = COALESCE(incentive_total,0)
 *
 * Rationale (2026-10-16 updated): Finance sheet uses disbursement-based People Cost.
 * Verified across Apr-Sep 2026 threshold sweep: Rs 7,000/employee threshold minimises
 * max EBITDA gap to ±1.48L vs ±14L with gross-only and ±17L reverse with net-only.
 * - Normal months (|net-gross| < 7000): net_salary matches Finance exactly (May ≈0, Jun ≈0, Jul ≈0)
 * - Unusual months (|net-gross| ≥ 7000): average smooths Apr TDS credits and Sep/Aug F&F recoveries
 *
 * net_salary already accounts for: employee PF, ESIC, TDS, professional_tax, loan_emi,
 * advance_recovery, lwp_deduction, other_deductions. No further subtraction needed.
 *
 * Running-salary snapshot limit: pnl_running_salary_snapshot stores only earned_salary_till_date
 * (no deduction columns), so a month read from the snapshot (before payroll is run) remains CTC.
 *
 * Every reader (Live P&L, Statement, CEO Overview, trend, daily trend, drilldown, cost-centre
 * activity, process/LOB tabs) must build its sum from this file so the tile, the drawer and the
 * trend bar can never disagree again.
 *
 * Running-salary snapshot limit: pnl_running_salary_snapshot stores only earned_salary_till_date
 * (no deduction columns), so a month read from the snapshot (before payroll is run) remains CTC.
 */

/** Columns the rule reads, in the order the rule lists them. */
export const PEOPLE_COST_CTC_COLUMNS = ["net_salary", "pf_employer", "esic_employer", "gratuity"] as const;
export const PEOPLE_COST_INCENTIVE_COLUMN = "incentive_total" as const;
/** Kept for interface compatibility — deductions now come from net_salary, no longer subtracted separately. */
export const PEOPLE_COST_OTHER_DEDUCTION_COLUMNS = [] as const;
export const PEOPLE_COST_LEAVE_DEDUCTION_COLUMNS = [] as const;

/** Legacy fallback used by the column-aware readers when salary_prep_line has no gratuity column. */
const GRATUITY_BASIC_RATE = "0.0481";

export interface PeopleCostExprs {
  gross: string;
  pfEmployer: string;
  esicEmployer: string;
  gratuity: string;
  /** CTC paid = gross + pfEmployer + esicEmployer + gratuity. */
  ctcPaid: string;
  /** incentive_total (part of People Cost since 2026-10-05). */
  incentive: string;
  /** other_deductions + loan_emi + advance_recovery. */
  otherDeduction: string;
  /** lwp_deduction. */
  leaveDeduction: string;
  /** CTC paid − (other deduction + leave deduction). */
  peopleCost: string;
}

function col(alias: string, column: string): string {
  return `COALESCE(${alias}.${column}, 0)`;
}

function build(parts: {
  gross: string; pfEmployer: string; esicEmployer: string; gratuity: string; incentive: string;
  other: string[]; leave: string[];
}): PeopleCostExprs {
  const ctcPaid = `(${parts.gross} + ${parts.pfEmployer} + ${parts.esicEmployer} + ${parts.gratuity})`;
  const otherDeduction = parts.other.length ? `(${parts.other.join(" + ")})` : "0";
  const leaveDeduction = parts.leave.length ? `(${parts.leave.join(" + ")})` : "0";
  return {
    gross: parts.gross,
    pfEmployer: parts.pfEmployer,
    esicEmployer: parts.esicEmployer,
    gratuity: parts.gratuity,
    ctcPaid,
    incentive: parts.incentive,
    otherDeduction,
    leaveDeduction,
    peopleCost: `(${ctcPaid} + ${parts.incentive} - (${otherDeduction} + ${leaveDeduction}))`,
  };
}

/**
 * Adaptive disbursement basis: net_salary when routine (|net-gross| < Rs 7,000),
 * otherwise smoothed average (net+gross)/2 for F&F or year-start TDS anomalies.
 */
function adaptiveDisbursement(alias: string): string {
  const net = `COALESCE(${alias}.net_salary, ${alias}.gross_salary)`;
  const gross = `${alias}.gross_salary`;
  return `CASE WHEN ABS(${net} - ${gross}) < 7000 THEN ${net} ELSE (${net} + ${gross}) / 2 END`;
}

/** Every piece of the rule for a salary_prep_line alias whose columns are all known to exist. */
export function peopleCostExprs(alias: string): PeopleCostExprs {
  return build({
    gross: adaptiveDisbursement(alias),
    pfEmployer: col(alias, "pf_employer"),
    esicEmployer: col(alias, "esic_employer"),
    gratuity: col(alias, "gratuity"),
    incentive: col(alias, PEOPLE_COST_INCENTIVE_COLUMN),
    other: [],  // deductions already in net_salary
    leave: [],  // deductions already in net_salary
  });
}

/** The per-line People Cost SQL expression, e.g. `SUM(${peopleCostSql("l")})`. */
export function peopleCostSql(alias: string): string {
  return peopleCostExprs(alias).peopleCost;
}

/**
 * Column-aware variant for readers that probe salary_prep_line with listColumns(): a missing column
 * contributes 0, and a missing gratuity column falls back to basic × 4.81% exactly as those readers
 * did before this file existed.
 */
export function peopleCostExprsForColumns(alias: string, columns: ReadonlySet<string>): PeopleCostExprs {
  const opt = (column: string) => (columns.has(column) ? col(alias, column) : "0");
  const gratuity = columns.has("gratuity")
    ? col(alias, "gratuity")
    : columns.has("basic")
    ? `${col(alias, "basic")} * ${GRATUITY_BASIC_RATE}`
    : "0";
  const netBasis = columns.has("net_salary") && columns.has("gross_salary")
    ? adaptiveDisbursement(alias)
    : columns.has("net_salary")
    ? opt("net_salary")
    : opt("gross_salary");
  return build({
    gross: netBasis,
    pfEmployer: opt("pf_employer"),
    esicEmployer: opt("esic_employer"),
    gratuity,
    incentive: opt(PEOPLE_COST_INCENTIVE_COLUMN),
    other: [],  // deductions already in net_salary
    leave: [],  // deductions already in net_salary
  });
}

/** Column-aware per-line People Cost SQL expression. */
export function peopleCostSqlForColumns(alias: string, columns: ReadonlySet<string>): string {
  return peopleCostExprsForColumns(alias, columns).peopleCost;
}
