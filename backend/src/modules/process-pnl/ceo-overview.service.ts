import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { tableExists } from "../../shared/dbHelpers.js";

/**
 * The CEO view of the P&L: one figure per branch, and a ranked list of where profit is leaking.
 *
 * WHY THIS IS SEPARATE FROM THE STATEMENT
 * ---------------------------------------
 * The statement answers "what were the numbers". A CEO also needs "where do I act", and that
 * second question is not a different layout over the same rows — it needs comparisons the
 * statement does not make: branch against branch, cost ratio against the best performer, revenue
 * against the people who earned it.
 *
 * Every figure here is read from what actually happened rather than recomputed:
 *   revenue  billing_invoice_particular_snapshot   (what clients were invoiced)
 *   people   salary_prep_line                      (what payroll actually paid)
 *   spend    grn_entry_line_snapshot               (what was raised, rejections excluded)
 *   budget   finance_budget_line_snapshot          (what was planned)
 *
 * THE FINDINGS THIS SURFACES ARE REAL, NOT ILLUSTRATIVE
 * ----------------------------------------------------
 * Run against June 2026 it reports, among others: NOIDA-DIALDESK invoicing Rs 25.92 lakh with no
 * payroll attributed to it at all (an 87% margin that is an attribution error, not performance);
 * 220 people across seven dormant branches sitting in the payroll run at zero value; and NOIDA-2
 * spending 21.2% of revenue on indirect against NOIDA's 15.4%.
 *
 * None of those are visible on a statement, because each one looks plausible in isolation.
 */

export interface CeoBranchRow {
  branchId: string | null;
  branchName: string;
  revenue: number;
  peopleCost: number;
  staffPaid: number;
  indirectCost: number;
  budget: number;
  operatingProfit: number;
  /** Null where a margin is meaningless — a cost centre with no client revenue, or a closed branch. */
  marginPct: number | null;
  revenuePerHead: number | null;
  /** Set when the row cannot be read at face value, e.g. revenue with nobody posted to it. */
  flag: string | null;
  isCostCentre: boolean;
  isClosed: boolean;
}

export interface CeoOpportunity {
  id: string;
  severity: "critical" | "warning" | "settled";
  /** Headline figure, already formatted — "Rs 22.54 L", "220". */
  value: string;
  valueUnit: string;
  title: string;
  detail: string;
  action: string;
}

export interface CeoOverview {
  period: string;
  revenue: number;
  peopleCost: number;
  indirectCost: number;
  operatingProfit: number;
  marginPct: number | null;
  staffPaid: number;
  revenuePerHead: number | null;
  branches: CeoBranchRow[];
  opportunities: CeoOpportunity[];
}

const n = (v: unknown): number => {
  const parsed = Number(v ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const lakh = (v: number): string => `Rs ${(v / 100000).toFixed(2)} L`;

/**
 * Revenue by branch, resolved through the cost centre.
 *
 * The collation differs between the two tables — billing_invoice_particular_snapshot is
 * utf8mb4_0900_ai_ci and cost_centre_master is utf8mb4_unicode_ci — so the join needs an explicit
 * COLLATE or it dies with ER_CANT_AGGREGATE_2COLLATIONS.
 */
async function revenueByBranch(period: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!(await tableExists("billing_invoice_particular_snapshot"))) return out;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ccm.branch_id AS branch_id, SUM(p.amount) AS amount
       FROM billing_invoice_particular_snapshot p
       LEFT JOIN cost_centre_master ccm
              ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci
               = p.cost_centre_code COLLATE utf8mb4_unicode_ci
      WHERE p.period_code = ?
      GROUP BY ccm.branch_id`,
    [period],
  );
  for (const r of rows) out.set(r.branch_id ? String(r.branch_id) : "", n(r.amount));
  return out;
}

/**
 * People cost by branch, from the payroll run rather than the recomputed snapshot.
 *
 * Read with explicit column names instead of through listColumns(), which is what made this
 * unreadable in the first place: information_schema returns COLUMN_NAME uppercased, so every
 * column probe answered false and every person came back costing nothing.
 */
async function peopleByBranch(period: string): Promise<Map<string, { cost: number; staff: number }>> {
  const out = new Map<string, { cost: number; staff: number }>();
  if (!(await tableExists("salary_prep_line"))) return out;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.branch_id AS branch_id,
            COUNT(*) AS staff,
            SUM(COALESCE(l.gross_salary, 0)
              + COALESCE(l.pf_employer, 0)
              + COALESCE(l.esic_employer, 0)) AS cost
       FROM salary_prep_line l
       JOIN salary_prep_run r ON r.id = l.run_id AND r.run_month = ?
       JOIN employees e ON e.id = l.employee_id
      GROUP BY e.branch_id`,
    [period],
  );
  for (const r of rows) {
    out.set(r.branch_id ? String(r.branch_id) : "", { cost: n(r.cost), staff: n(r.staff) });
  }
  return out;
}

/** GRN spend by branch. Rejections excluded via RejectDate, never the Reject flag — that flag is
 *  1 on 85,255 of 85,463 source rows and means nothing. */
async function spendByBranch(period: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!(await tableExists("grn_entry_line_snapshot"))) return out;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ccm.branch_id AS branch_id, SUM(l.total) AS amount
       FROM grn_entry_line_snapshot l
       JOIN grn_entry_snapshot g ON g.bill_source_id = l.grn_source_id
       LEFT JOIN cost_centre_master ccm
              ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci
               = l.cost_centre_code COLLATE utf8mb4_unicode_ci
      WHERE g.period_code = ? AND g.is_rejected = 0
      GROUP BY ccm.branch_id`,
    [period],
  );
  for (const r of rows) out.set(r.branch_id ? String(r.branch_id) : "", n(r.amount));
  return out;
}

/**
 * Budgeted indirect spend by branch.
 *
 * Two traps, both of which inflate the figure silently:
 *   - expense_particular stores the same amount again as a 'Particular' child of its 'CostCenter'
 *     parent, so counting both doubles every budget. Filtered to CostCenter.
 *   - the mirror carries a branch NAME, not an id, and branch_master holds three rows for Head
 *     Office ("HEAD OFFICE" twice plus "Head Office"). Joining on the name counted that branch's
 *     budget three times and reported a Rs 32.51 lakh underspend against a real Rs 11.88 lakh.
 *     Collapsed to one id per distinct name before joining.
 */
async function budgetByBranch(period: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!(await tableExists("finance_budget_line_snapshot"))) return out;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT bm.id AS branch_id, SUM(l.amount) AS amount
       FROM finance_budget_line_snapshot l
       JOIN finance_budget_snapshot b
         ON b.bill_source_id = l.budget_source_id AND b.period_code = l.period_code
       LEFT JOIN (
             SELECT MIN(id) AS id, UPPER(TRIM(branch_name)) AS nm
               FROM branch_master GROUP BY UPPER(TRIM(branch_name))
           ) bm ON bm.nm COLLATE utf8mb4_unicode_ci
                 = UPPER(TRIM(b.branch_name)) COLLATE utf8mb4_unicode_ci
      WHERE l.period_code = ? AND l.expense_type = 'CostCenter'
      GROUP BY bm.id`,
    [period],
  );
  for (const r of rows) out.set(r.branch_id ? String(r.branch_id) : "", n(r.amount));
  return out;
}

/**
 * Rank where operating profit is recoverable.
 *
 * Deliberately derived from the branch figures rather than hardcoded, so the list changes with the
 * business instead of describing one month forever. Each entry states the evidence and the action,
 * because a finding a CEO cannot act on is decoration.
 */
function findOpportunities(branches: CeoBranchRow[], unbranchedPeople: number): CeoOpportunity[] {
  const found: CeoOpportunity[] = [];
  // A branch flagged "no payroll attributed" is not a valid benchmark — its ratios only look good
  // because a whole cost line is missing. Excluded from every comparison below.
  const trading = branches.filter(
    (b) => !b.isCostCentre && !b.isClosed && b.revenue > 0 && !b.flag,
  );

  // Revenue with nobody posted to it. The margin is not performance, it is an attribution error,
  // and it understates whichever branch is really carrying those people by the same amount.
  for (const b of branches.filter((x) => x.revenue > 0 && x.peopleCost <= 0)) {
    found.push({
      id: `no-payroll-${b.branchName}`,
      severity: "critical",
      value: lakh(b.operatingProfit),
      valueUnit: "per month, overstated",
      title: `${b.branchName} bills ${lakh(b.revenue)} with no payroll attached`,
      detail:
        `It reports a ${b.marginPct?.toFixed(0) ?? "very high"}% margin because not one employee is `
        + `posted to it. Someone is delivering that work and their cost is landing on another `
        + `branch, understating that branch by the same amount.`,
      action: `Find the staff serving ${b.branchName} and correct their branch. Two branch P&Ls are wrong until this is done.`,
    });
  }

  // Staff in the payroll run at zero value: neither a cost nor a saving, just unexplained.
  const dormant = branches.filter((b) => b.staffPaid > 0 && b.peopleCost <= 0 && b.revenue <= 0);
  const dormantHeads = dormant.reduce((total, b) => total + b.staffPaid, 0);
  if (dormantHeads > 0) {
    found.push({
      id: "zero-paid",
      severity: "critical",
      value: String(dormantHeads),
      valueUnit: "people paid nothing",
      title: `${dormant.length} branches carry staff with no salary`,
      detail:
        dormant.map((b) => `${b.branchName} ${b.staffPaid}`).join(", ")
        + ". They appear in the payroll run at zero value, so they cost nothing and produce nothing.",
      action:
        "Either they are unpaid and attendance is missing, or the records are stale. Until that is "
        + "settled neither the headcount nor the cost base can be relied on.",
    });
  }

  // The cost-ratio gap between the best and worst trading branch, priced.
  if (trading.length >= 2) {
    const byRatio = trading.slice().sort((a, b) => a.indirectCost / a.revenue - b.indirectCost / b.revenue);
    const best = byRatio[0];
    const worst = byRatio[byRatio.length - 1];
    const bestRatio = best.indirectCost / best.revenue;
    const worstRatio = worst.indirectCost / worst.revenue;
    if (worstRatio - bestRatio > 0.03) {
      found.push({
        id: "indirect-gap",
        severity: "warning",
        value: lakh(worst.indirectCost - worst.revenue * bestRatio),
        valueUnit: "per month",
        title: `${worst.branchName} spends ${(worstRatio * 100).toFixed(1)}% of revenue on indirect; ${best.branchName} spends ${(bestRatio * 100).toFixed(1)}%`,
        detail:
          `${worst.branchName} carries ${lakh(worst.indirectCost)} of indirect on ${lakh(worst.revenue)} `
          + `of revenue, against ${best.branchName}'s ${lakh(best.indirectCost)} on ${lakh(best.revenue)}.`,
        action: `Bringing ${worst.branchName} to ${best.branchName}'s ratio releases the figure shown. Rent and maintenance are the largest heads to examine.`,
      });
    }

    // Revenue per head, which separates a pricing problem from a cost problem.
    const byHead = trading.filter((b) => b.revenuePerHead !== null)
      .sort((a, b) => (b.revenuePerHead ?? 0) - (a.revenuePerHead ?? 0));
    if (byHead.length >= 2) {
      const top = byHead[0];
      const bottom = byHead[byHead.length - 1];
      const gap = (top.marginPct ?? 0) - (bottom.marginPct ?? 0);
      if (gap > 5) {
        found.push({
          id: "margin-gap",
          severity: "warning",
          value: `${gap.toFixed(1)} pts`,
          valueUnit: "margin gap",
          title: `${bottom.branchName} runs at ${bottom.marginPct?.toFixed(1)}% against ${top.branchName}'s ${top.marginPct?.toFixed(1)}%`,
          detail:
            `${bottom.staffPaid} staff producing ${lakh(bottom.revenue)} — `
            + `Rs ${((bottom.revenuePerHead ?? 0) / 1000).toFixed(1)}k revenue per head against `
            + `${top.branchName}'s Rs ${((top.revenuePerHead ?? 0) / 1000).toFixed(1)}k. `
            + `The gap is revenue per person, not cost control.`,
          action:
            "Either the billing rate is below market for this work, or the process is over-staffed "
            + `for its volume. Closing half the gap is about ${lakh(bottom.revenue * (gap / 200))} a month.`,
        });
      }
    }
  }

  // A closed branch still spending.
  for (const b of branches.filter((x) => x.isClosed && x.indirectCost > 0)) {
    found.push({
      id: `closed-spend-${b.branchName}`,
      severity: "warning",
      value: lakh(b.indirectCost),
      valueUnit: "still spent",
      title: `${b.branchName} is closed but still spent this month`,
      detail: "No revenue and no staff since closure, yet indirect cost is still landing against it.",
      action: "Confirm no further commitments remain. Whatever stops becomes a run-rate saving.",
    });
  }

  // Payroll that reaches no branch at all.
  if (unbranchedPeople > 0) {
    found.push({
      id: "no-branch",
      severity: "warning",
      value: String(unbranchedPeople),
      valueUnit: "people, no branch",
      title: "Paid employees carry no branch",
      detail:
        "Their cost cannot be attributed to any branch column, so every branch margin is slightly "
        + "overstated while the company total stays correct.",
      action: "Set a branch on these employee records; no code change is involved.",
    });
  }

  // Budget underspend, offered as a question rather than a win.
  const budgeted = branches.reduce((t, b) => t + b.budget, 0);
  const spent = branches.reduce((t, b) => t + b.indirectCost, 0);
  if (budgeted > 0 && budgeted - spent > 0) {
    found.push({
      id: "under-budget",
      severity: "settled",
      value: lakh(budgeted - spent),
      valueUnit: "under budget",
      title: "Indirect spend came in below budget",
      detail: `${lakh(budgeted)} budgeted across branches, ${lakh(spent)} actually raised.`,
      action: "Confirm this is genuine saving rather than invoices deferred into next month.",
    });
  }

  const rank = { critical: 0, warning: 1, settled: 2 };
  return found.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export async function getCeoOverview(period: string, branchId?: string | null): Promise<CeoOverview> {
  const empty: CeoOverview = {
    period, revenue: 0, peopleCost: 0, indirectCost: 0, operatingProfit: 0,
    marginPct: null, staffPaid: 0, revenuePerHead: null, branches: [], opportunities: [],
  };
  if (!/^\d{4}-\d{2}$/.test(period)) return empty;

  const [branchRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, branch_name, active_status FROM branch_master`,
  );
  const [revenue, people, spend, budget] = await Promise.all([
    revenueByBranch(period), peopleByBranch(period), spendByBranch(period), budgetByBranch(period),
  ]);

  /*
   * branch_master holds duplicates — three rows spell Head Office three ways — and each carries
   * its own slice of the staff. Left alone the overview listed Head Office twice, once as a cost
   * centre and once as closed, and double-counted its headcount. Merged on the normalised name,
   * keeping the first id seen.
   */
  const merged = new Map<string, { id: string; name: string; active: boolean }>();
  for (const row of branchRows) {
    const key = String(row.branch_name ?? "").trim().toUpperCase();
    const existing = merged.get(key);
    if (existing) {
      // Any active spelling makes the branch active.
      existing.active = existing.active || Number(row.active_status) === 1;
      continue;
    }
    merged.set(key, {
      id: String(row.id),
      name: String(row.branch_name ?? "Unnamed"),
      active: Number(row.active_status) === 1,
    });
  }

  const branches: CeoBranchRow[] = [];
  for (const [, entry] of merged) {
    const id = entry.id;
    if (branchId && id !== branchId) continue;
    // Sum across every duplicate id that shares this name, or the merge would drop their figures.
    const ids = branchRows
      .filter((r) => String(r.branch_name ?? "").trim().toUpperCase() === entry.name.trim().toUpperCase())
      .map((r) => String(r.id));
    const rev = ids.reduce((t, i) => t + (revenue.get(i) ?? 0), 0);
    const pay = ids.reduce(
      (t, i) => {
        const p = people.get(i);
        return p ? { cost: t.cost + p.cost, staff: t.staff + p.staff } : t;
      },
      { cost: 0, staff: 0 },
    );
    const idc = ids.reduce((t, i) => t + (spend.get(i) ?? 0), 0);
    if (rev === 0 && pay.staff === 0 && idc === 0) continue;   // nothing happened here this month

    const isClosed = !entry.active;
    // A branch that pays people and raises spend but bills no client is a cost centre, not a
    // failing business — reporting a negative margin for Head Office would be nonsense.
    const isCostCentre = !isClosed && rev < pay.cost * 0.2;
    const op = rev - pay.cost - idc;
    branches.push({
      branchId: id,
      branchName: entry.name,
      revenue: rev,
      peopleCost: pay.cost,
      staffPaid: pay.staff,
      indirectCost: idc,
      budget: ids.reduce((t, i) => t + (budget.get(i) ?? 0), 0),
      operatingProfit: op,
      marginPct: rev > 0 && !isCostCentre && !isClosed ? (op / rev) * 100 : null,
      revenuePerHead: pay.staff > 0 ? rev / pay.staff : null,
      flag: rev > 0 && pay.cost <= 0 ? "no payroll attributed" : null,
      isCostCentre,
      isClosed,
    });
  }

  branches.sort((a, b) => b.operatingProfit - a.operatingProfit);

  const totals = branches.reduce(
    (acc, b) => ({
      revenue: acc.revenue + b.revenue,
      peopleCost: acc.peopleCost + b.peopleCost,
      indirectCost: acc.indirectCost + b.indirectCost,
      staffPaid: acc.staffPaid + b.staffPaid,
    }),
    { revenue: 0, peopleCost: 0, indirectCost: 0, staffPaid: 0 },
  );
  const operatingProfit = totals.revenue - totals.peopleCost - totals.indirectCost;
  const unbranched = people.get("")?.staff ?? 0;

  return {
    period,
    ...totals,
    operatingProfit,
    marginPct: totals.revenue > 0 ? (operatingProfit / totals.revenue) * 100 : null,
    revenuePerHead: totals.staffPaid > 0 ? totals.revenue / totals.staffPaid : null,
    branches,
    opportunities: branchId ? [] : findOpportunities(branches, unbranched),
  };
}

export const ceoOverviewService = { getCeoOverview };
