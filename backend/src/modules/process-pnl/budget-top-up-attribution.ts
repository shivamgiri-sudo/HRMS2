import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { tableExists } from "../../shared/dbHelpers.js";

const n = (v: unknown): number => {
  const parsed = Number(v ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * Header-level budget top-ups (db_bill expense_reopen_master.AdditionalAmount, mirrored as
 * finance_budget_snapshot.reopen_additional_amount) for the budgets that fund a set of cost
 * centres, split into the part attributable to that set and the part that is not.
 *
 * A top-up is sanctioned on the budget HEADER and names no cost centre, so:
 *   - `attributable` — top-ups of approved budgets whose EVERY 'CostCenter' line is one of `codes`.
 *     The whole budget belongs to the set, so its top-up does too. No estimation involved.
 *   - `shared` — top-ups of approved budgets that fund the set AND other cost centres. Reported so a
 *     reader knows it exists; never pro-rated (same no-guessing rule as the budget drilldown and
 *     budget-cost-centre-utilization.service.ts).
 *
 * Same approval filter as ceo-overview.service.ts budgetByBranch() (active_status = 1,
 * is_rejected = 0). Shared by the CEO focus panel's budget and the budget drilldown under a
 * process / cost-centre scope, so the two can only agree (audit item 16, 2026-09-23).
 */
export async function focusBudgetTopUps(
  period: string,
  codes: string[],
): Promise<{ attributable: number; shared: number }> {
  const out = { attributable: 0, shared: 0 };
  if (!/^\d{4}-\d{2}$/.test(period) || codes.length === 0) return out;
  if (!(await tableExists("finance_budget_snapshot")) || !(await tableExists("finance_budget_line_snapshot"))) return out;
  const marks = codes.map(() => "?").join(",");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT b.bill_source_id, MAX(b.reopen_additional_amount) AS top_up,
            SUM(CASE WHEN l.expense_type_name IN (${marks}) THEN 1 ELSE 0 END) AS in_scope_lines,
            COUNT(*) AS cost_centre_lines
       FROM finance_budget_snapshot b
       JOIN finance_budget_line_snapshot l
         ON l.budget_source_id = b.bill_source_id AND l.period_code = b.period_code
        AND l.expense_type = 'CostCenter'
      WHERE b.period_code = ? AND b.active_status = 1 AND b.is_rejected = 0
        AND b.reopen_additional_amount <> 0
      GROUP BY b.bill_source_id
     HAVING in_scope_lines > 0`,
    [...codes, period],
  );
  for (const r of rows) {
    const amount = n(r.top_up);
    if (n(r.in_scope_lines) === n(r.cost_centre_lines)) out.attributable += amount;
    else out.shared += amount;
  }
  return out;
}
