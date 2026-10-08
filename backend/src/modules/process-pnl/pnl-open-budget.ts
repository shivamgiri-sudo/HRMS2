import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { tableExists } from "../../shared/dbHelpers.js";

/**
 * OPEN-BUDGET RESERVE (owner accounting rule 2026-10-06). Live P&L counts a budget line at its full
 * budgeted amount while it is OPEN and at actual (GRN reserved + consumed) once it is CLOSED. Actual
 * GRN spend is already in the P&L (readGrnSpend), so what an open line adds on top is its unspent
 * headroom: max(0, budget - reserved - consumed). A closed line adds nothing, so closing a line
 * that came in under budget lowers the cost by exactly the unused amount.
 *
 * A line is closed when its head/sub-head is closed (finance_budget_subhead_closure, sql/1534 —
 * closing every head/sub-head is closing the whole budget) or its cost centre is closed for that
 * budget (finance_budget_cost_centre_closure, migration 2118).
 *
 * Amounts are ex-GST, the basis reserve()/consume() write reserved_amount/consumed_amount on.
 * A branch-pooled line (no cost centre) is spread over its finance_budget_line_allocation rows in
 * proportion to their amounts; with no allocation it stays at branch level (unallocatedByBranch).
 */
export interface OpenBudgetReserve {
  byCostCentre: Map<string, number>;
  unallocatedByBranch: Map<string, number>;
}

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export async function readOpenBudgetReserve(period: string): Promise<OpenBudgetReserve> {
  const out: OpenBudgetReserve = { byCostCentre: new Map(), unallocatedByBranch: new Map() };
  if (!/^\d{4}-\d{2}$/.test(period) || !(await tableExists("finance_budget_line"))) return out;
  const hasSubheadClosure = await tableExists("finance_budget_subhead_closure");
  const hasCcClosure = await tableExists("finance_budget_cost_centre_closure");

  const [lines] = await db.execute<RowDataPacket[]>(
    `SELECT l.id, l.budget_id, h.branch_id, l.cost_centre_id,
            COALESCE(NULLIF(l.base_amount, 0), NULLIF(l.gross_amount - l.tax_amount, 0), l.pnl_cost_amount, 0) AS spendable,
            COALESCE(l.reserved_amount, 0) + COALESCE(l.consumed_amount, 0) AS used,
            ${hasSubheadClosure
              ? `EXISTS (SELECT 1 FROM finance_budget_subhead_closure c
                          WHERE c.budget_id = l.budget_id AND c.head = l.head
                            AND c.sub_head = COALESCE(l.sub_head, '') AND c.status = 'closed')`
              : "0"} AS subhead_closed
       FROM finance_budget_line l
       JOIN finance_budget_header h ON h.id = l.budget_id
      WHERE h.period_code = ? AND h.status = 'active'`,
    [period],
  );
  if (!lines.length) return out;

  const closedCc = new Set<string>();
  if (hasCcClosure) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT c.budget_id, c.cost_centre_id
         FROM finance_budget_cost_centre_closure c
         JOIN finance_budget_header h ON h.id = c.budget_id
        WHERE h.period_code = ? AND c.status = 'closed'`,
      [period],
    );
    for (const r of rows) closedCc.add(`${r.budget_id}|${r.cost_centre_id}`);
  }

  const pooledIds = lines.filter((l) => !l.cost_centre_id).map((l) => String(l.id));
  const allocations = new Map<string, Array<{ costCentreId: string; amount: number }>>();
  if (pooledIds.length && (await tableExists("finance_budget_line_allocation"))) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT budget_line_id, cost_centre_id, base_amount
         FROM finance_budget_line_allocation
        WHERE budget_line_id IN (${pooledIds.map(() => "?").join(",")}) AND cost_centre_id IS NOT NULL`,
      pooledIds,
    );
    for (const r of rows) {
      const list = allocations.get(String(r.budget_line_id)) ?? [];
      list.push({ costCentreId: String(r.cost_centre_id), amount: n(r.base_amount) });
      allocations.set(String(r.budget_line_id), list);
    }
  }

  const add = (map: Map<string, number>, key: string, amount: number) => {
    if (amount > 0) map.set(key, (map.get(key) ?? 0) + amount);
  };
  for (const line of lines) {
    if (n(line.subhead_closed)) continue;
    const headroom = Math.max(0, n(line.spendable) - n(line.used));
    if (headroom <= 0) continue;
    const budgetId = String(line.budget_id);
    if (line.cost_centre_id) {
      if (!closedCc.has(`${budgetId}|${line.cost_centre_id}`)) add(out.byCostCentre, String(line.cost_centre_id), headroom);
      continue;
    }
    const shares = allocations.get(String(line.id)) ?? [];
    const shareTotal = shares.reduce((s, a) => s + a.amount, 0);
    if (!shares.length || shareTotal <= 0) {
      add(out.unallocatedByBranch, String(line.branch_id ?? ""), headroom);
      continue;
    }
    for (const share of shares) {
      if (closedCc.has(`${budgetId}|${share.costCentreId}`)) continue;
      add(out.byCostCentre, share.costCentreId, (headroom * share.amount) / shareTotal);
    }
  }
  for (const [k, v] of out.byCostCentre) out.byCostCentre.set(k, Math.round(v * 100) / 100);
  for (const [k, v] of out.unallocatedByBranch) out.unallocatedByBranch.set(k, Math.round(v * 100) / 100);
  return out;
}
