/**
 * THE People Cost definition for every P&L surface (owner rule, confirmed 2026-09-24).
 *
 * People Cost for a month, per salary_prep_line:
 *
 *   People Cost = CTC paid − (Other deduction + Leave deduction)
 *
 *   CTC paid        = COALESCE(gross_salary,0) + COALESCE(pf_employer,0)
 *                   + COALESCE(esic_employer,0) + COALESCE(gratuity,0)
 *   Other deduction = COALESCE(other_deductions,0) + COALESCE(loan_emi,0)
 *                   + COALESCE(advance_recovery,0)
 *   Leave deduction = COALESCE(lwp_deduction,0)
 *
 * Statutory EMPLOYEE-side deductions (pf_employee, esic_employee, professional_tax, tds) are NOT
 * part of Other deduction: they are still the company's cost of the person, only routed to the
 * government instead of the employee.
 *
 * Live evidence (Aug 2026, 1,244 staff): CTC paid Rs 197.19L; other_deductions Rs 18,700 +
 * loan_emi Rs 50,000 + advance_recovery 0 = Other Rs 68,700; lwp_deduction 0 → People Cost
 * Rs 196.50L. gross_salary is already after leave, so lwp_deduction is subtracted as the owner
 * stated the rule (it is 0 today); do not "fix" that without the owner.
 *
 * Every reader (Live P&L, Statement, CEO Overview, trend, daily trend, drilldown, cost-centre
 * activity, process/LOB tabs) must build its sum from this file so the tile, the drawer and the
 * trend bar can never disagree again.
 *
 * Running-salary snapshot limit: pnl_running_salary_snapshot stores only earned_salary_till_date
 * (no deduction columns), so a month read from the snapshot (before payroll is run) remains CTC.
 */

/** Columns the rule reads, in the order the rule lists them. */
export const PEOPLE_COST_CTC_COLUMNS = ["gross_salary", "pf_employer", "esic_employer", "gratuity"] as const;
export const PEOPLE_COST_OTHER_DEDUCTION_COLUMNS = ["other_deductions", "loan_emi", "advance_recovery"] as const;
export const PEOPLE_COST_LEAVE_DEDUCTION_COLUMNS = ["lwp_deduction"] as const;

/** Legacy fallback used by the column-aware readers when salary_prep_line has no gratuity column. */
const GRATUITY_BASIC_RATE = "0.0481";

export interface PeopleCostExprs {
  gross: string;
  pfEmployer: string;
  esicEmployer: string;
  gratuity: string;
  /** CTC paid = gross + pfEmployer + esicEmployer + gratuity. */
  ctcPaid: string;
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
  gross: string; pfEmployer: string; esicEmployer: string; gratuity: string;
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
    otherDeduction,
    leaveDeduction,
    peopleCost: `(${ctcPaid} - (${otherDeduction} + ${leaveDeduction}))`,
  };
}

/** Every piece of the rule for a salary_prep_line alias whose columns are all known to exist. */
export function peopleCostExprs(alias: string): PeopleCostExprs {
  return build({
    gross: col(alias, "gross_salary"),
    pfEmployer: col(alias, "pf_employer"),
    esicEmployer: col(alias, "esic_employer"),
    gratuity: col(alias, "gratuity"),
    other: PEOPLE_COST_OTHER_DEDUCTION_COLUMNS.map((c) => col(alias, c)),
    leave: PEOPLE_COST_LEAVE_DEDUCTION_COLUMNS.map((c) => col(alias, c)),
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
  return build({
    gross: opt("gross_salary"),
    pfEmployer: opt("pf_employer"),
    esicEmployer: opt("esic_employer"),
    gratuity,
    other: PEOPLE_COST_OTHER_DEDUCTION_COLUMNS.filter((c) => columns.has(c)).map((c) => col(alias, c)),
    leave: PEOPLE_COST_LEAVE_DEDUCTION_COLUMNS.filter((c) => columns.has(c)).map((c) => col(alias, c)),
  });
}

/** Column-aware per-line People Cost SQL expression. */
export function peopleCostSqlForColumns(alias: string, columns: ReadonlySet<string>): string {
  return peopleCostExprsForColumns(alias, columns).peopleCost;
}
