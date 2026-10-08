import { readBudgetEntries, topUpsForCodes } from "./pnl-budget-source.js";

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
 * 2026-09-23 (owner budget-source rule): computed over pnl-budget-source.ts readBudgetEntries(), the
 * one budget reader. For a branch + month with an active HRMS budget the mirror is not read at all,
 * so its top-ups disappear with it; HRMS top-ups are applied into the budget lines themselves
 * (budget-topup.service.ts) and need no header-level attribution. Shared by the CEO focus panel's
 * budget and the budget drilldown under a process / cost-centre scope, so the two can only agree
 * (audit item 16).
 */
export async function focusBudgetTopUps(
  period: string,
  codes: string[],
): Promise<{ attributable: number; shared: number }> {
  if (!/^\d{4}-\d{2}$/.test(period) || codes.length === 0) return { attributable: 0, shared: 0 };
  return topUpsForCodes(await readBudgetEntries(period), codes);
}
