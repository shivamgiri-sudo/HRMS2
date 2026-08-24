import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { tableExists } from "../../shared/dbHelpers.js";

/**
 * Whether a cost centre is actually working, on one definition, in one place.
 *
 * THE RULE, as the business states it
 * -----------------------------------
 *   A cost centre is ACTIVE if a client paid us for it in the trailing window,
 *   OR if people posted to it were paid a salary in that window.
 *
 * Everything else is inactive, with one state kept separate rather than collapsed:
 * SPEND_ONLY, where no client pays and nobody works there but GRN spend is still landing.
 * That was Rs 40.52 lakh across 32 cost centres in May-Jul 2026. Calling it "inactive" and
 * filtering it out would make real money vanish from the P&L, so it is named and counted.
 *
 * WHY THIS EXISTS AT ALL
 * ----------------------
 * Three systems gave three different answers, and none matched the business:
 *   mas_hrms cost_centre_master.active_status   166 active
 *   db_bill  cost_master.active                 580 active
 *   this rule                                    95 active
 * The mas_hrms flag had drifted furthest — 407 of 927 cost centres disagreed with db_bill,
 * and 36 flagged inactive there were still earning money, so a P&L filtered on it silently
 * dropped over Rs 40 lakh of revenue.
 *
 * The rule was validated before being encoded: every one of the 95 it calls active is also
 * flagged active in db_bill, so it never resurrects something finance has closed — it only
 * narrows 580 to the ones really trading. And all 831 it calls inactive had zero revenue and
 * zero salary, so nothing is being hidden.
 *
 * db_bill's flag remains the REGISTER (it is honest about what is closed); this is the FILTER.
 */

export type CostCentreActivity = "active" | "spend_only" | "inactive";

export interface CostCentreActivityRow {
  costCentreId: string;
  costCentreCode: string | null;
  costCentreName: string | null;
  activity: CostCentreActivity;
  /** Client revenue invoiced in the window. */
  revenue: number;
  /** Distinct employees posted here who were paid in the window. */
  peoplePaid: number;
  /** Loaded salary of those people, over the window. */
  salaryCost: number;
  /** GRN spend attributed here in the window. */
  spend: number;
}

/** Trailing months the rule looks back over. Three, as agreed. */
export const ACTIVITY_WINDOW_MONTHS = 3;

/**
 * The window as an inclusive list of period codes, ending at (and including) the period given.
 * Built by calendar arithmetic rather than string maths so a December window rolls the year.
 */
export function activityWindow(endPeriod: string, months = ACTIVITY_WINDOW_MONTHS): string[] {
  const match = /^(\d{4})-(\d{2})$/.exec(endPeriod);
  if (!match) return [];
  const year = Number(match[1]);
  const month = Number(match[2]);
  const periods: string[] = [];
  for (let back = months - 1; back >= 0; back--) {
    const d = new Date(Date.UTC(year, month - 1 - back, 1));
    periods.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return periods;
}

/**
 * Classify every cost centre for the window ending at `endPeriod`.
 *
 * Written as one query per signal rather than one joined query: revenue, salary and spend live
 * in three unrelated tables at three different grains, and joining them produces a fan-out that
 * multiplies the amounts. They are combined in memory instead, where the arithmetic is visible.
 */
export async function getCostCentreActivity(endPeriod: string): Promise<CostCentreActivityRow[]> {
  const periods = activityWindow(endPeriod);
  if (periods.length === 0) return [];
  const placeholders = periods.map(() => "?").join(",");

  const [centres] = await db.execute<RowDataPacket[]>(
    `SELECT id, cost_centre_code, cost_centre_name FROM cost_centre_master`,
  );

  // Salary is the signal that needs no mirror — payroll is native to mas_hrms.
  const [salary] = await db.execute<RowDataPacket[]>(
    `SELECT e.cost_centre_id AS id,
            COUNT(DISTINCT l.employee_id) AS people_paid,
            SUM(l.gross_salary + COALESCE(l.pf_employer, 0) + COALESCE(l.esic_employer, 0)) AS salary_cost
       FROM salary_prep_line l
       JOIN salary_prep_run run ON run.id = l.run_id
       JOIN employees e ON e.id = l.employee_id
      WHERE run.run_month IN (${placeholders}) AND e.cost_centre_id IS NOT NULL
      GROUP BY e.cost_centre_id`,
    periods,
  );

  const revenue = new Map<string, number>();
  const spend = new Map<string, number>();

  // Both revenue and GRN spend come from the db_bill mirror, keyed by cost centre CODE.
  // Guarded so an installation without the mirror degrades to salary-only rather than throwing.
  if (await tableExists("billing_invoice_particular_snapshot")) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT cost_centre_code AS code, SUM(amount) AS amount
         FROM billing_invoice_particular_snapshot
        WHERE period_code IN (${placeholders}) AND cost_centre_code IS NOT NULL
        GROUP BY cost_centre_code`,
      periods,
    );
    for (const r of rows) revenue.set(String(r.code).trim().toUpperCase(), Number(r.amount ?? 0));
  }

  if (await tableExists("grn_entry_line_snapshot")) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT l.cost_centre_code AS code, SUM(l.amount) AS amount
         FROM grn_entry_line_snapshot l
         JOIN grn_entry_snapshot g ON g.bill_source_id = l.grn_source_id
        WHERE g.period_code IN (${placeholders}) AND g.is_rejected = 0
          AND l.cost_centre_code IS NOT NULL
        GROUP BY l.cost_centre_code`,
      periods,
    );
    for (const r of rows) spend.set(String(r.code).trim().toUpperCase(), Number(r.amount ?? 0));
  }

  const salaryById = new Map(
    salary.map((r) => [String(r.id), {
      peoplePaid: Number(r.people_paid ?? 0),
      salaryCost: Number(r.salary_cost ?? 0),
    }]),
  );

  return centres.map((c) => {
    const id = String(c.id);
    const key = String(c.cost_centre_code ?? "").trim().toUpperCase();
    const pay = salaryById.get(id) ?? { peoplePaid: 0, salaryCost: 0 };
    const rev = revenue.get(key) ?? 0;
    const spn = spend.get(key) ?? 0;

    // The rule. Revenue OR people paid means active; spend alone is its own state.
    const activity: CostCentreActivity =
      rev > 0 || pay.peoplePaid > 0 ? "active" : spn > 0 ? "spend_only" : "inactive";

    return {
      costCentreId: id,
      costCentreCode: c.cost_centre_code ? String(c.cost_centre_code) : null,
      costCentreName: c.cost_centre_name ? String(c.cost_centre_name) : null,
      activity,
      revenue: rev,
      peoplePaid: pay.peoplePaid,
      salaryCost: pay.salaryCost,
      spend: spn,
    };
  });
}

export interface AttributionGap {
  costCentreCode: string;
  costCentreName: string | null;
  revenue: number;
  salaryCost: number;
  /** 'revenue_without_people' or 'people_without_revenue'. */
  kind: "revenue_without_people" | "people_without_revenue";
}

/**
 * Cost centres where revenue and the people who earn it are recorded in different places.
 *
 * This is the single largest threat to a per-cost-centre P&L, and it is invisible unless
 * looked for: a cost centre that bills a client but has nobody posted to it reports a 100%
 * margin, which reads as the best-performing line in the report rather than as a gap.
 *
 * Measured over Apr-Jul 2026: between 24% and 33% of monthly revenue sat on cost centres with
 * no payroll (Rs 121 lakh in June alone), and Rs 52-140 lakh of salary sat on cost centres
 * with no revenue. Godfrey Philips is the clearest case — 161 staff on BSS/OB/AHMH-JD/465
 * while the billing lands on /474, so one shows pure cost and the other pure profit, and both
 * are wrong.
 *
 * No code can decide where those people belong; that is a posting decision. What code can do
 * is refuse to present the resulting margin as fact. Callers should show these alongside the
 * figures, not filter them away.
 */
export async function getAttributionGaps(endPeriod: string): Promise<AttributionGap[]> {
  const rows = await getCostCentreActivity(endPeriod);
  return rows
    .filter((r) => (r.revenue > 0 && r.salaryCost === 0) || (r.salaryCost > 0 && r.revenue === 0))
    .map((r) => ({
      costCentreCode: r.costCentreCode ?? "(unknown)",
      costCentreName: r.costCentreName,
      revenue: r.revenue,
      salaryCost: r.salaryCost,
      kind: r.revenue > 0 ? ("revenue_without_people" as const) : ("people_without_revenue" as const),
    }))
    .sort((a, b) => (b.revenue + b.salaryCost) - (a.revenue + a.salaryCost));
}

/** Just the ids that are active, for callers that only need to filter. */
export async function getActiveCostCentreIds(endPeriod: string): Promise<Set<string>> {
  const rows = await getCostCentreActivity(endPeriod);
  return new Set(rows.filter((r) => r.activity === "active").map((r) => r.costCentreId));
}

export const costCentreActivityService = {
  getCostCentreActivity,
  getAttributionGaps,
  getActiveCostCentreIds,
  activityWindow,
  ACTIVITY_WINDOW_MONTHS,
};
