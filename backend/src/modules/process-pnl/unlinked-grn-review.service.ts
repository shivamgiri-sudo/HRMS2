import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * Unlinked GRN Review (/finance/unlinked-grn-review) — built 2026-08-22 as the permanent,
 * always-checkable answer to "how would I know if any GRN reached approved status without
 * being linked to a budget line", after the FY2026-27 remediation session (see
 * [[hrms2-grn-cost-allocation-budget-blind-spot]]) fixed ~1,388 of ~1,505 such GRNs by hand.
 *
 * A GRN can legitimately have no grn_cost_allocation row for one of two reasons:
 *   - it hasn't been approved yet (draft/submitted) — not a problem, excluded here
 *   - its accounting_period is in the future — deliberately not yet budgeted, not a problem,
 *     shown separately so it doesn't read as an outstanding issue
 * Everything else IS a real gap, sub-classified by why it can't resolve, matching the exact
 * categories the remediation script itself used to decide new-line vs top-up vs refuse:
 *   - NO_COST_CENTRE: the GRN carries no cost_centre_id at all — nothing to attribute against,
 *     a data-quality issue on the record itself, not a budgeting gap
 *   - NO_BRANCH_BUDGET: the branch has no finance_budget_header for that exact month at all
 *   - NO_MATCHING_LINE: a budget exists for that branch/month, but no line covers this
 *     cost-centre + head + sub-head combination (head coverage gap)
 *   - HEADROOM_EXCEEDED: a line matches exactly, but its remaining (gross - reserved -
 *     consumed) is less than this GRN's amount — real overspend against what was approved
 */

export type UnlinkedGrnCategory =
  | "FUTURE_DEFERRED"
  | "NO_COST_CENTRE"
  | "NO_BRANCH_BUDGET"
  | "NO_MATCHING_LINE"
  | "HEADROOM_EXCEEDED";

export interface UnlinkedGrnRow {
  grnId: string;
  grnNumber: string;
  grnType: string;
  status: string;
  branchId: string;
  branchName: string;
  costCentreId: string | null;
  costCentreName: string | null;
  head: string;
  subHead: string | null;
  accountingPeriod: string;
  amountWithTax: number;
  category: UnlinkedGrnCategory;
  /** Only set for HEADROOM_EXCEEDED — how much the line is short by. */
  shortfall: number | null;
}

export interface UnlinkedGrnSummary {
  category: UnlinkedGrnCategory;
  count: number;
  amount: number;
}

export interface UnlinkedGrnReview {
  asOfPeriod: string;
  rows: UnlinkedGrnRow[];
  summary: UnlinkedGrnSummary[];
  totalCount: number;
  totalAmount: number;
}

function n(v: unknown): number {
  return Number(v ?? 0);
}

function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export async function getUnlinkedGrnReview(filters: {
  branchId?: string;
  /** Include FUTURE_DEFERRED rows in the main list — off by default, they aren't a problem. */
  includeFutureDeferred?: boolean;
} = {}): Promise<UnlinkedGrnReview> {
  const asOfPeriod = currentPeriod();

  const where: string[] = [
    "g.status NOT IN ('draft', 'rejected', 'cancelled')",
    "NOT EXISTS (SELECT 1 FROM grn_cost_allocation gca WHERE gca.grn_request_id = g.id)",
  ];
  const params: unknown[] = [];
  if (filters.branchId) {
    where.push("g.branch_id = ?");
    params.push(filters.branchId);
  }

  const [grns] = await db.execute<RowDataPacket[]>(
    `SELECT g.id, g.grn_number, g.grn_type, g.status, g.branch_id, bm.branch_name,
            g.cost_centre_id, ccm.cost_centre_name, g.head, g.sub_head,
            g.accounting_period, g.financial_year, g.amount_with_tax
       FROM grn_request g
       JOIN branch_master bm ON bm.id = g.branch_id
       LEFT JOIN cost_centre_master ccm ON ccm.id = g.cost_centre_id
      WHERE ${where.join(" AND ")}
      ORDER BY g.accounting_period, bm.branch_name`,
    params
  );

  if (!grns.length) {
    return { asOfPeriod, rows: [], summary: [], totalCount: 0, totalAmount: 0 };
  }

  // Batch-load everything needed to classify, rather than one query per GRN.
  const [headers] = await db.execute<RowDataPacket[]>(
    `SELECT id, branch_id, period_code FROM finance_budget_header WHERE status = 'active'`
  );
  const headerByKey = new Map<string, { id: string }>();
  for (const h of headers) headerByKey.set(`${h.branch_id}|${h.period_code}`, { id: String(h.id) });

  const [lines] = await db.execute<RowDataPacket[]>(
    `SELECT l.id, l.budget_id, l.cost_centre_id, l.head, l.sub_head,
            l.gross_amount, l.reserved_amount, l.consumed_amount
       FROM finance_budget_line l`
  );
  const lineByKey = new Map<string, RowDataPacket>();
  for (const l of lines) {
    lineByKey.set(`${l.budget_id}|${l.cost_centre_id}|${l.head}|${l.sub_head ?? ""}`, l);
  }

  const rows: UnlinkedGrnRow[] = grns.map((g) => {
    const isFuture = String(g.accounting_period) > asOfPeriod;
    const base = {
      grnId: String(g.id),
      grnNumber: String(g.grn_number),
      grnType: String(g.grn_type),
      status: String(g.status),
      branchId: String(g.branch_id),
      branchName: String(g.branch_name),
      costCentreId: g.cost_centre_id ? String(g.cost_centre_id) : null,
      costCentreName: g.cost_centre_name ? String(g.cost_centre_name) : null,
      head: String(g.head),
      subHead: g.sub_head ? String(g.sub_head) : null,
      accountingPeriod: String(g.accounting_period),
      amountWithTax: n(g.amount_with_tax),
    };

    if (isFuture) {
      return { ...base, category: "FUTURE_DEFERRED" as const, shortfall: null };
    }
    if (!g.cost_centre_id) {
      return { ...base, category: "NO_COST_CENTRE" as const, shortfall: null };
    }
    const header = headerByKey.get(`${g.branch_id}|${g.accounting_period}`);
    if (!header) {
      return { ...base, category: "NO_BRANCH_BUDGET" as const, shortfall: null };
    }
    const line = lineByKey.get(`${header.id}|${g.cost_centre_id}|${g.head}|${g.sub_head ?? ""}`);
    if (!line) {
      return { ...base, category: "NO_MATCHING_LINE" as const, shortfall: null };
    }
    const available = n(line.gross_amount) - n(line.reserved_amount) - n(line.consumed_amount);
    const shortfall = Math.max(0, n(g.amount_with_tax) - available);
    return { ...base, category: "HEADROOM_EXCEEDED" as const, shortfall };
  });

  const visibleRows = filters.includeFutureDeferred
    ? rows
    : rows.filter((r) => r.category !== "FUTURE_DEFERRED");

  const summaryMap = new Map<UnlinkedGrnCategory, { count: number; amount: number }>();
  for (const r of rows) {
    const cur = summaryMap.get(r.category) ?? { count: 0, amount: 0 };
    cur.count += 1;
    cur.amount += r.amountWithTax;
    summaryMap.set(r.category, cur);
  }
  const summary: UnlinkedGrnSummary[] = [...summaryMap.entries()].map(([category, v]) => ({
    category, count: v.count, amount: Math.round(v.amount * 100) / 100,
  }));

  const problemRows = rows.filter((r) => r.category !== "FUTURE_DEFERRED");
  return {
    asOfPeriod,
    rows: visibleRows,
    summary,
    totalCount: problemRows.length,
    totalAmount: Math.round(problemRows.reduce((s, r) => s + r.amountWithTax, 0) * 100) / 100,
  };
}

export const unlinkedGrnReviewService = { getUnlinkedGrnReview };
