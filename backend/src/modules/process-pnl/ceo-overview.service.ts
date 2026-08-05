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

export interface CeoFilters {
  branchId?: string | null;
  processId?: string | null;
  costCentreId?: string | null;
}

/** A month on the margin trend line. */
export interface CeoTrendPoint {
  period: string;
  revenue: number;
  operatingProfit: number;
  marginPct: number | null;
}

/**
 * The P&L for one process or cost centre, shown when a filter narrows to it.
 *
 * Process is not a grain the data supports across the board — only 18 of 66 processes carry
 * revenue at all — which is why the whole-company view stays at branch level. But for a
 * well-mapped one it holds up completely, and refusing to show it would withhold a real answer
 * because other rows are incomplete.
 *
 * So it is shown WITH its caveats attached rather than either hidden or presented bare. Onfido in
 * June is the worked example: Rs 90.39 lakh invoiced against Rs 32.05 lakh of payroll and
 * Rs 24.93 lakh of indirect — a 37% margin that is real, except that the indirect figure is the
 * ENTIRE NOIDA-2 branch GRN booked to this one cost centre, which the notes say out loud.
 */
export interface CeoFocus {
  kind: "process" | "cost_centre";
  label: string;
  revenue: number;
  invoiceLines: number;
  peopleCost: number;
  staffPaid: number;
  staffZeroPaid: number;
  indirectCost: number;
  budget: number;
  operatingProfit: number;
  marginPct: number | null;
  revenuePerHead: number | null;
  costPerHead: number | null;
  /** What a reader must know before trusting the margin above. Empty when nothing is amiss. */
  notes: string[];
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
  trend: CeoTrendPoint[];
  /** Distinct values for the filter controls, so the UI never invents an option that has no data. */
  options: { processes: { id: string; name: string }[]; costCentres: { id: string; code: string }[] };
  /** Present only when a process or cost centre filter is active. */
  focus: CeoFocus | null;
}

const n = (v: unknown): number => {
  const parsed = Number(v ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const lakh = (v: number): string => `Rs ${(v / 100000).toFixed(2)} L`;

/**
 * Only this company's own trading.
 *
 * cost_centre_master.company_name carries the legal entity, and the P&L had been consolidating
 * three of them. June 2026, before this filter:
 *
 *   Mas Callnet   revenue Rs 295.75 L   payroll Rs 210.28 L (1,162)   indirect Rs 72.62 L
 *   IDC           revenue Rs  76.32 L   payroll Rs   0.00 L (    0)   indirect Rs  4.38 L
 *   unmapped      revenue Rs   0.00 L   payroll Rs  17.60 L (  368)
 *
 * IDC contributed Rs 76.32 lakh of revenue across 38 cost centres and NOT ONE employee, which is
 * what lifted the consolidated margin to 17.8%. NOIDA-DIALDESK is a third entity again, Ispark
 * Dataconnect. Confirmed with the user: IDC is a separate company and this page is MAS Callnet's.
 *
 * Payroll is NOT filtered by company, deliberately. Every employee in this system belongs to MAS
 * Callnet — all 937 active staff with a cost centre map to it, IDC has none at all, and the 368
 * without a cost centre sit in MAS Callnet branches. Filtering payroll by cost centre would drop
 * Rs 17.60 lakh of real MAS wages simply because those employees lack a mapping.
 *
 * Matched on a normalised name because the source spells it four ways ("MAS Call Net India Pvt
 * Ltd", "Mas Callnet India Pvt. Ltd.", "Mas Callnet India Pvt Ltd", "MAS CALLNET INDIA PVT LTD.").
 */
const OWN_COMPANY_SQL = `REPLACE(REPLACE(REPLACE(LOWER(COALESCE(ccm.company_name, '')), '.', ''), ' ', ''), ',', '') LIKE '%mascallnet%'`;

/**
 * Revenue by branch, resolved through the cost centre.
 *
 * The collation differs between the two tables — billing_invoice_particular_snapshot is
 * utf8mb4_0900_ai_ci and cost_centre_master is utf8mb4_unicode_ci — so the join needs an explicit
 * COLLATE or it dies with ER_CANT_AGGREGATE_2COLLATIONS.
 */
async function revenueByBranch(period: string, f: CeoFilters): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!(await tableExists("billing_invoice_particular_snapshot"))) return out;
  const where: string[] = ["p.period_code = ?", OWN_COMPANY_SQL];
  const params: unknown[] = [period];
  if (f.costCentreId) { where.push("ccm.id = ?"); params.push(f.costCentreId); }
  // Cost centre carries no process_id on any live row, so a process narrows revenue through the
  // employees actually posted to that cost centre — the same modal rule the actuals use.
  if (f.processId) {
    where.push(`ccm.id IN (SELECT DISTINCT e.cost_centre_id FROM employees e
                            WHERE e.process_id = ? AND e.cost_centre_id IS NOT NULL)`);
    params.push(f.processId);
  }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ccm.branch_id AS branch_id, SUM(p.amount) AS amount
       FROM billing_invoice_particular_snapshot p
       LEFT JOIN cost_centre_master ccm
              ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci
               = p.cost_centre_code COLLATE utf8mb4_unicode_ci
      WHERE ${where.join(" AND ")}
      GROUP BY ccm.branch_id`,
    params,
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
async function peopleByBranch(period: string, f: CeoFilters): Promise<Map<string, { cost: number; staff: number }>> {
  const out = new Map<string, { cost: number; staff: number }>();
  if (!(await tableExists("salary_prep_line"))) return out;
  const where: string[] = ["r.run_month = ?"];
  const params: unknown[] = [period];
  if (f.processId) { where.push("e.process_id = ?"); params.push(f.processId); }
  if (f.costCentreId) { where.push("e.cost_centre_id = ?"); params.push(f.costCentreId); }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.branch_id AS branch_id,
            COUNT(*) AS staff,
            SUM(COALESCE(l.gross_salary, 0)
              + COALESCE(l.pf_employer, 0)
              + COALESCE(l.esic_employer, 0)) AS cost
       FROM salary_prep_line l
       JOIN salary_prep_run r ON r.id = l.run_id
       JOIN employees e ON e.id = l.employee_id
      WHERE ${where.join(" AND ")}
      GROUP BY e.branch_id`,
    params,
  );
  for (const r of rows) {
    out.set(r.branch_id ? String(r.branch_id) : "", { cost: n(r.cost), staff: n(r.staff) });
  }
  return out;
}

/** GRN spend by branch. Rejections excluded via RejectDate, never the Reject flag — that flag is
 *  1 on 85,255 of 85,463 source rows and means nothing. */
async function spendByBranch(period: string, f: CeoFilters): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!(await tableExists("grn_entry_line_snapshot"))) return out;
  const where: string[] = ["g.period_code = ?", "g.is_rejected = 0", OWN_COMPANY_SQL];
  const params: unknown[] = [period];
  if (f.costCentreId) { where.push("ccm.id = ?"); params.push(f.costCentreId); }
  if (f.processId) {
    where.push(`ccm.id IN (SELECT DISTINCT e.cost_centre_id FROM employees e
                            WHERE e.process_id = ? AND e.cost_centre_id IS NOT NULL)`);
    params.push(f.processId);
  }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ccm.branch_id AS branch_id, SUM(l.total) AS amount
       FROM grn_entry_line_snapshot l
       JOIN grn_entry_snapshot g ON g.bill_source_id = l.grn_source_id
       LEFT JOIN cost_centre_master ccm
              ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci
               = l.cost_centre_code COLLATE utf8mb4_unicode_ci
      WHERE ${where.join(" AND ")}
      GROUP BY ccm.branch_id`,
    params,
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
/*
 * Active budgets only. `expense_master.Active` is db_bill's fully-approved marker: for FY2026-27
 * it is 1 on exactly the 177 rows carrying all three approvals and 0 on exactly the 367 carrying
 * only the first — the correlation is perfect, so this one predicate says "approved" without
 * needing to test the approval columns as well. Do NOT use EntryStatus for this: it is 1 on 61 of
 * the active rows and on 206 of the inactive ones, so it means something else entirely.
 *
 * Without it this summed all 544 rows — Rs 456.03 L against a real approved budget of Rs 130.00 L,
 * overstating it 2.5x and making every underspend on this screen fiction.
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
        AND b.active_status = 1
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

/**
 * Four months of margin for the sparkline, in three aggregate queries rather than four full
 * overview passes — the trend is a shape, not a drill-down, and paying 1.7s per point for it
 * would make the page slower than the engine it replaced.
 */
async function marginTrend(endPeriod: string, f: CeoFilters): Promise<CeoTrendPoint[]> {
  const [year, month] = endPeriod.split("-").map(Number);
  const periods: string[] = [];
  for (let back = 3; back >= 0; back--) {
    const d = new Date(Date.UTC(year, month - 1 - back, 1));
    periods.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  /*
   * All four months at once, not one after another.
   *
   * Written as a sequential loop first, which cost 8.5-11.3s on production: four round trips of
   * three queries each, every one waiting on the last for no reason — the months are independent.
   * Issuing them together brings the page back to roughly the cost of a single month.
   */
  const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
  return Promise.all(
    periods.map(async (period) => {
      const [rev, ppl, spend] = await Promise.all([
        revenueByBranch(period, f), peopleByBranch(period, f), spendByBranch(period, f),
      ]);
      const revenue = sum(rev);
      const people = [...ppl.values()].reduce((a, b) => a + b.cost, 0);
      const operatingProfit = revenue - people - sum(spend);
      return {
        period, revenue, operatingProfit,
        marginPct: revenue > 0 ? (operatingProfit / revenue) * 100 : null,
      };
    }),
  );
}

/** Only offer a filter value that has data behind it — an option that returns an empty page is
 *  indistinguishable from a broken one. */
async function filterOptions(period: string) {
  const [processes] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT pm.id AS id, pm.process_name AS name
       FROM salary_prep_line l
       JOIN salary_prep_run r ON r.id = l.run_id AND r.run_month = ?
       JOIN employees e ON e.id = l.employee_id
       JOIN process_master pm ON pm.id = e.process_id
      WHERE pm.active_status = 1
      ORDER BY pm.process_name`,
    [period],
  );
  const [costCentres] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT ccm.id AS id, ccm.cost_centre_code AS code
       FROM billing_invoice_particular_snapshot p
       JOIN cost_centre_master ccm
         ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci
          = p.cost_centre_code COLLATE utf8mb4_unicode_ci
      WHERE p.period_code = ?
      ORDER BY ccm.cost_centre_code`,
    [period],
  );
  return {
    processes: processes.map((r) => ({ id: String(r.id), name: String(r.name) })),
    costCentres: costCentres.map((r) => ({ id: String(r.id), code: String(r.code) })),
  };
}

/**
 * The P&L for the one process or cost centre a filter has narrowed to, with its caveats.
 *
 * The caveats are the point. Onfido's June margin of 37% is real, but its indirect line is the
 * whole NOIDA-2 branch GRN booked against a single cost centre — so the figure is a contribution,
 * not a standalone P&L, and a reader has no way to know that from the number itself. Every note
 * below is derived from the data rather than written in, so it stays true as the mapping improves.
 */
async function buildFocus(
  period: string,
  f: CeoFilters,
  totals: { revenue: number; peopleCost: number; indirectCost: number; staffPaid: number },
): Promise<CeoFocus | null> {
  if (!f.processId && !f.costCentreId) return null;

  const notes: string[] = [];
  let label = "";
  let kind: "process" | "cost_centre" = f.processId ? "process" : "cost_centre";
  let invoiceLines = 0;
  let staffZeroPaid = 0;
  let budget = 0;

  if (f.processId) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT process_name FROM process_master WHERE id = ? LIMIT 1`, [f.processId],
    );
    label = rows[0]?.process_name ? String(rows[0].process_name) : "Process";
    const [paid] = await db.execute<RowDataPacket[]>(
      `SELECT SUM(CASE WHEN COALESCE(l.gross_salary, 0) = 0 THEN 1 ELSE 0 END) AS zero_paid
         FROM salary_prep_line l
         JOIN salary_prep_run r ON r.id = l.run_id AND r.run_month = ?
         JOIN employees e ON e.id = l.employee_id
        WHERE e.process_id = ?`,
      [period, f.processId],
    );
    staffZeroPaid = n(paid[0]?.zero_paid);
  } else if (f.costCentreId) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT cost_centre_code FROM cost_centre_master WHERE id = ? LIMIT 1`, [f.costCentreId],
    );
    label = rows[0]?.cost_centre_code ? String(rows[0].cost_centre_code) : "Cost centre";
  }

  // Invoice lines and budget both key on the cost centre CODE, so resolve the codes in scope once.
  const [codes] = await db.execute<RowDataPacket[]>(
    f.costCentreId
      ? `SELECT cost_centre_code AS code, branch_id FROM cost_centre_master WHERE id = ?`
      : `SELECT DISTINCT ccm.cost_centre_code AS code, ccm.branch_id AS branch_id
           FROM employees e JOIN cost_centre_master ccm ON ccm.id = e.cost_centre_id
          WHERE e.process_id = ?`,
    [f.costCentreId ?? f.processId],
  );
  const codeList = codes.map((r) => String(r.code)).filter(Boolean);

  if (codeList.length > 0) {
    const marks = codeList.map(() => "?").join(",");
    const [inv] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM billing_invoice_particular_snapshot
        WHERE period_code = ? AND cost_centre_code IN (${marks})`,
      [period, ...codeList],
    );
    invoiceLines = n(inv[0]?.n);

    // Approved budgets only — see budgetByBranch. Summing every mirrored row counts 367 rows
    // that never got past the first approval.
    const [bud] = await db.execute<RowDataPacket[]>(
      `SELECT COALESCE(SUM(l.amount), 0) AS a
         FROM finance_budget_line_snapshot l
         JOIN finance_budget_snapshot b
           ON b.bill_source_id = l.budget_source_id AND b.period_code = l.period_code
        WHERE l.period_code = ? AND l.expense_type = 'CostCenter'
          AND l.expense_type_name IN (${marks})
          AND b.active_status = 1`,
      [period, ...codeList],
    );
    budget = n(bud[0]?.a);

    // Does this cost centre carry its whole branch's overhead? If so the margin is a contribution,
    // not a standalone P&L, and saying so is the difference between a usable figure and a wrong one.
    const branchId = codes[0]?.branch_id ? String(codes[0].branch_id) : null;
    if (branchId && totals.indirectCost > 0) {
      const [branchGrn] = await db.execute<RowDataPacket[]>(
        `SELECT COALESCE(SUM(l.total), 0) AS a
           FROM grn_entry_line_snapshot l
           JOIN grn_entry_snapshot g ON g.bill_source_id = l.grn_source_id
           LEFT JOIN cost_centre_master ccm
                  ON ccm.cost_centre_code COLLATE utf8mb4_unicode_ci
                   = l.cost_centre_code COLLATE utf8mb4_unicode_ci
          WHERE g.period_code = ? AND g.is_rejected = 0 AND ccm.branch_id = ?`,
        [period, branchId],
      );
      const branchTotal = n(branchGrn[0]?.a);
      if (branchTotal > 0 && totals.indirectCost / branchTotal >= 0.95) {
        notes.push(
          `The indirect figure is effectively the whole branch's overhead (${lakh(branchTotal)}) `
          + `booked to this cost centre, not what it alone consumes. Treat the margin as a `
          + `contribution: the standalone figure would be higher.`,
        );
      }
    }
  }

  if (staffZeroPaid > 0) {
    notes.push(`${staffZeroPaid} of ${totals.staffPaid + staffZeroPaid} payroll lines were paid nothing, so the people cost covers the rest.`);
  }
  if (totals.revenue > 0 && totals.peopleCost <= 0) {
    notes.push("Revenue is billed here but no payroll is attributed, so the margin is an attribution error rather than performance.");
  }
  if (totals.revenue <= 0 && totals.peopleCost > 0) {
    notes.push("People are paid here but no invoice maps to it, so this shows cost without the revenue it earned.");
  }

  const operatingProfit = totals.revenue - totals.peopleCost - totals.indirectCost;
  return {
    kind, label,
    revenue: totals.revenue,
    invoiceLines,
    peopleCost: totals.peopleCost,
    staffPaid: totals.staffPaid,
    staffZeroPaid,
    indirectCost: totals.indirectCost,
    budget,
    operatingProfit,
    marginPct: totals.revenue > 0 ? (operatingProfit / totals.revenue) * 100 : null,
    revenuePerHead: totals.staffPaid > 0 ? totals.revenue / totals.staffPaid : null,
    costPerHead: totals.staffPaid > 0 ? totals.peopleCost / totals.staffPaid : null,
    notes,
  };
}

export async function getCeoOverview(period: string, filters: CeoFilters = {}): Promise<CeoOverview> {
  const branchId = filters.branchId ?? null;
  const empty: CeoOverview = {
    period, revenue: 0, peopleCost: 0, indirectCost: 0, operatingProfit: 0,
    marginPct: null, staffPaid: 0, revenuePerHead: null, branches: [], opportunities: [],
    trend: [], options: { processes: [], costCentres: [] }, focus: null,
  };
  if (!/^\d{4}-\d{2}$/.test(period)) return empty;

  const [branchRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, branch_name, active_status FROM branch_master`,
  );
  const [revenue, people, spend, budget, trend, options] = await Promise.all([
    revenueByBranch(period, filters), peopleByBranch(period, filters),
    spendByBranch(period, filters), budgetByBranch(period),
    marginTrend(period, filters), filterOptions(period),
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
    // A narrowed view compares nothing against nothing, and a branch-scoped user must not be shown
    // findings computed across branches they cannot see.
    opportunities: branchId || filters.processId || filters.costCentreId
      ? []
      : findOpportunities(branches, unbranched),
    /*
     * The trend sums its source maps directly, while the headline is built from the branch rows —
     * which drop any branch where nothing happened at all. That left the last bar reading 18.1%
     * beside a headline of 17.8%: the same figure, on the same card, twice. The current month is
     * replaced with the headline so the two can never disagree.
     */
    focus: await buildFocus(period, filters, {
      revenue: totals.revenue,
      peopleCost: totals.peopleCost,
      indirectCost: totals.indirectCost,
      staffPaid: totals.staffPaid,
    }),
    trend: trend.map((point) =>
      point.period === period
        ? { ...point, revenue: totals.revenue, operatingProfit, marginPct: totals.revenue > 0 ? (operatingProfit / totals.revenue) * 100 : null }
        : point,
    ),
    options,
  };
}

export const ceoOverviewService = { getCeoOverview };
