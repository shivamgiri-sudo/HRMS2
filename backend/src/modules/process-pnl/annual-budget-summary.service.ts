import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { tableExists } from "../../shared/dbHelpers.js";

/**
 * Annual Budget Summary — budget vs. actual, per branch (or all branches), for every month
 * of a financial year. Built 2026-08-21 in response to: "we have real historical budgets
 * (db_bill) and expenses (GRN) for past months, why can't we see an annual summary".
 *
 * DATA SOURCES, both confirmed live before writing this file — neither gap from the earlier
 * investigation actually blocks the FY2026-27 ask this was built for:
 *   - ACTUAL: `grn_request.accounting_period` — the full, complete GRN history (vendor +
 *     imprest + salary), 2017-04 through 2027-03, 84,788 rows. This is NOT the narrower
 *     `grn_entry_snapshot`/`grn_entry_line_snapshot` mirror ceo-overview.service.ts uses
 *     (that one only covers 2025-04 onward, 6,284 rows) — grn_request is the complete source
 *     and needs no extension.
 *   - BUDGET: `finance_budget_snapshot`/`finance_budget_line_snapshot`, the nightly-refreshed
 *     db_bill mirror. Confirmed live: real coverage for every FY2026-27 month that has
 *     actually happened (Apr-Aug 2026); the native workspace
 *     (`finance_budget_header`/`finance_budget_line`) has only 5 rows across 4 branches and
 *     cannot answer this on its own — see docs/superpowers/specs/
 *     2026-08-21-annual-budget-summary-and-historical-pnl.md for the full investigation.
 *
 * The budget query below is a DELIBERATE DUPLICATE of ceo-overview.service.ts's own
 * `budgetByBranch` (not imported — that module is being concurrently edited by another
 * session this same day, confirmed via git status, so this avoids touching it at all),
 * carrying forward every trap it already found and fixed:
 *   - `expense_particular`/mirror double-counts every amount once as 'CostCenter' and once
 *     as 'Particular' — filtered to `expense_type = 'CostCenter'`.
 *   - `branch_master` has 3 Head Office rows ("HEAD OFFICE" x2 + "Head Office") and the
 *     mirror only carries a branch NAME — collapsed to one id per distinct upper/trimmed name
 *     before joining, or a real budget gets triple-counted.
 *   - `active_status`/`is_rejected` are separate signals, not one refinement of the other —
 *     both filtered independently.
 *   - Header-level top-ups (`reopen_additional_amount`) have no lines of their own and are
 *     added once per header, not fanned out across the line-level SUM.
 */

export interface AnnualBudgetMonthRow {
  periodCode: string;
  budget: number;
  actual: number;
  variance: number;
}

export interface AnnualBudgetBranchRow {
  branchId: string;
  branchName: string;
  months: AnnualBudgetMonthRow[];
  annualBudget: number;
  annualActual: number;
  annualVariance: number;
}

export interface AnnualBudgetSummary {
  financialYear: string;
  periods: string[];
  branches: AnnualBudgetBranchRow[];
  grandTotal: { budget: number; actual: number; variance: number };
}

function n(v: unknown): number {
  return Number(v ?? 0);
}

/** Apr(year) .. Mar(year+1) period_codes for a "YYYY-YY" financial year string. */
function periodsForFinancialYear(financialYear: string): string[] {
  const startYear = Number(financialYear.split("-")[0]);
  const periods: string[] = [];
  for (let m = 4; m <= 12; m++) periods.push(`${startYear}-${String(m).padStart(2, "0")}`);
  for (let m = 1; m <= 3; m++) periods.push(`${startYear + 1}-${String(m).padStart(2, "0")}`);
  return periods;
}

async function budgetByBranchForPeriod(period: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!(await tableExists("finance_budget_line_snapshot"))) return out;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT branch_id, SUM(amount) AS amount FROM (
        SELECT bm.id AS branch_id, l.amount AS amount
          FROM finance_budget_line_snapshot l
          JOIN finance_budget_snapshot b
            ON b.bill_source_id = l.budget_source_id AND b.period_code = l.period_code
          LEFT JOIN (
                SELECT MIN(id) AS id, UPPER(TRIM(branch_name)) AS nm
                  FROM branch_master GROUP BY UPPER(TRIM(branch_name))
              ) bm ON bm.nm COLLATE utf8mb4_unicode_ci
                    = UPPER(TRIM(b.branch_name)) COLLATE utf8mb4_unicode_ci
         WHERE l.period_code = ? AND l.expense_type = 'CostCenter'
           AND b.active_status = 1 AND b.is_rejected = 0
        UNION ALL
        SELECT bm.id, b.reopen_additional_amount
          FROM finance_budget_snapshot b
          LEFT JOIN (
                SELECT MIN(id) AS id, UPPER(TRIM(branch_name)) AS nm
                  FROM branch_master GROUP BY UPPER(TRIM(branch_name))
              ) bm ON bm.nm COLLATE utf8mb4_unicode_ci
                    = UPPER(TRIM(b.branch_name)) COLLATE utf8mb4_unicode_ci
         WHERE b.period_code = ? AND b.active_status = 1 AND b.is_rejected = 0
           AND b.reopen_additional_amount <> 0
     ) sanctioned
      GROUP BY branch_id`,
    [period, period]
  );
  for (const r of rows) out.set(r.branch_id ? String(r.branch_id) : "", n(r.amount));
  return out;
}

/** Actual GRN spend by branch for one accounting_period. Matches the GRN Reports Register's
 *  own inclusion rule (grn-report.service.ts): accounting_period is Finance Month (never
 *  bill_date, see [[hrms2-grn-reports-finance-month]]), rejected/cancelled excluded.
 *
 * Resolved through the SAME name-collapsed branch id budgetByBranchForPeriod() uses — found
 * live 2026-08-21: branch_master carries both "HEAD OFFICE" and "Head Office" as separate
 * rows, and without this, GRN actuals land on one id while budget (already deduped) lands on
 * the other, so a single real branch shows as two incomplete halves instead of one row.
 * Same fix, applied on the actual side this time instead of the budget side. */
async function actualByBranchForPeriod(period: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT bm.id AS branch_id, SUM(g.amount_with_tax) AS amount
       FROM grn_request g
       LEFT JOIN branch_master gb ON gb.id = g.branch_id
       LEFT JOIN (
             SELECT MIN(id) AS id, UPPER(TRIM(branch_name)) AS nm
               FROM branch_master GROUP BY UPPER(TRIM(branch_name))
           ) bm ON bm.nm COLLATE utf8mb4_unicode_ci = UPPER(TRIM(gb.branch_name)) COLLATE utf8mb4_unicode_ci
      WHERE g.accounting_period = ? AND g.status NOT IN ('rejected', 'cancelled')
      GROUP BY bm.id`,
    [period]
  );
  for (const r of rows) out.set(r.branch_id ? String(r.branch_id) : "", n(r.amount));
  return out;
}

export async function getAnnualBudgetSummary(
  financialYear: string,
  branchIds?: string[]
): Promise<AnnualBudgetSummary> {
  const periods = periodsForFinancialYear(financialYear);

  // One row per DISTINCT branch name, not one per branch_master row — found live 2026-08-21:
  // 8 names (Head Office x3, Hyderabad/Jaipur/Jaipur IDC/Karnal/Meerut/Mohali x2 each) have
  // more than one branch_master row. Canonical id = MIN(id) per name, matching the exact
  // resolution budgetByBranchForPeriod()/actualByBranchForPeriod() already converge to, so a
  // caller-supplied id for any duplicate sibling still resolves to the same summary row a
  // caller who picked the "other" duplicate would get.
  const [canonicalRows] = await db.execute<RowDataPacket[]>(
    `SELECT canon.id, bm.branch_name, GROUP_CONCAT(sib.id) AS sibling_ids
       FROM (SELECT MIN(id) AS id, UPPER(TRIM(branch_name)) AS nm FROM branch_master GROUP BY UPPER(TRIM(branch_name))) canon
       JOIN branch_master bm ON bm.id = canon.id
       JOIN branch_master sib ON UPPER(TRIM(sib.branch_name)) = canon.nm
      GROUP BY canon.id, bm.branch_name
      ORDER BY bm.branch_name`
  );
  const requestedIds = new Set(branchIds ?? []);
  const branchRows = branchIds && branchIds.length
    ? canonicalRows.filter((r) =>
        String(r.sibling_ids).split(",").some((sib) => requestedIds.has(sib)) || requestedIds.has(String(r.id))
      )
    : canonicalRows;

  // One pass per period (not per branch x period) — 12 queries each side regardless of how
  // many branches are selected, same shape ceo-overview.service.ts already uses per-period.
  const budgetByPeriod = new Map<string, Map<string, number>>();
  const actualByPeriod = new Map<string, Map<string, number>>();
  for (const period of periods) {
    budgetByPeriod.set(period, await budgetByBranchForPeriod(period));
    actualByPeriod.set(period, await actualByBranchForPeriod(period));
  }

  const branches: AnnualBudgetBranchRow[] = branchRows.map((b) => {
    const branchId = String(b.id);
    const months: AnnualBudgetMonthRow[] = periods.map((periodCode) => {
      const budget = budgetByPeriod.get(periodCode)?.get(branchId) ?? 0;
      const actual = actualByPeriod.get(periodCode)?.get(branchId) ?? 0;
      return { periodCode, budget, actual, variance: budget - actual };
    });
    const annualBudget = months.reduce((s, m) => s + m.budget, 0);
    const annualActual = months.reduce((s, m) => s + m.actual, 0);
    return {
      branchId, branchName: String(b.branch_name), months,
      annualBudget, annualActual, annualVariance: annualBudget - annualActual,
    };
  });

  const grandTotal = branches.reduce(
    (acc, b) => ({
      budget: acc.budget + b.annualBudget,
      actual: acc.actual + b.annualActual,
      variance: acc.variance + b.annualVariance,
    }),
    { budget: 0, actual: 0, variance: 0 }
  );

  return { financialYear, periods, branches, grandTotal };
}

/** Branch options for the page's filter picker — same name-deduped canonical id every other
 *  function here resolves to (MIN(id) per distinct upper/trimmed branch_name), so a branchId
 *  picked from this list always matches a row getAnnualBudgetSummary() actually returns. */
export async function getAnnualBudgetSummaryBranches(): Promise<{ id: string; branchName: string }[]> {
  // Same MIN(id)-per-normalized-name canonicalization as getCompanyBudgetConsolidation's own
  // canonicalRows query, joined back to branch_master by that id (not by the GROUP BY
  // expression itself) so branch_name is read from a real row, not an ambiguous aggregate —
  // avoids ER_WRONG_FIELD_WITH_GROUP under ONLY_FULL_GROUP_BY.
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT bm.id, bm.branch_name
       FROM (SELECT MIN(id) AS id FROM branch_master GROUP BY UPPER(TRIM(branch_name))) canon
       JOIN branch_master bm ON bm.id = canon.id
      ORDER BY bm.branch_name`
  );
  return rows.map((r) => ({ id: String(r.id), branchName: String(r.branch_name) }));
}

export const annualBudgetSummaryService = { getAnnualBudgetSummary, getAnnualBudgetSummaryBranches };
