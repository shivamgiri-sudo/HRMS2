import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * Per-cost-centre budget vs actual for one branch budget, with a head / sub-head breakdown.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Cost Centre tab on /finance/branch-budget used to aggregate in the browser over
 * `finance_budget_line.cost_centre_id` alone. That column is only populated for lines planned
 * DIRECTLY at a cost centre (`planning_level = 'cost_centre'`). A line planned at branch level
 * (`planning_level = 'branch'`) carries a NULL there by design — its split across cost centres
 * lives in `finance_budget_line_allocation`, which the tab never read.
 *
 * Measured on production 2026-08-17: 85 of 117 budget lines are branch-level, every one of them
 * allocated, spreading 454 allocation rows over 9 cost centres. All of it collapsed into a single
 * "Branch Common (indirect)" row, so NOIDA-2's active 2026-08 budget displayed 2 cost centres
 * where 6 actually hold budget, hiding Rs 1,310,261 of allocation. Ahmedabad showed 1 of 2 and
 * NOIDA-2 September 1 of 7.
 *
 * BUDGETED is therefore read from two disjoint sources and unioned:
 *   - direct lines    (cost_centre_id IS NOT NULL) -> the line's own gross_amount
 *   - allocated lines (cost_centre_id IS NULL)     -> finance_budget_line_allocation.gross_amount
 * The IS NULL / IS NOT NULL split makes double-counting structurally impossible rather than
 * merely unlikely; verified against production, 0 direct lines also carry allocation rows.
 *
 * CONSUMED / RESERVED are MEASURED, never modelled. They come from `grn_cost_allocation`, which
 * records the cost centre each GRN actually hit, rather than pro-rating a line's total across its
 * cost centres by allocation share. Pro-rating would let a cost centre display spend it never
 * incurred, which on a variance report is worse than displaying nothing. The cost of that choice
 * is honest and visible: GRN allocations whose own cost_centre_id was never written are reported
 * under a separate `isUnattributed` row instead of being silently spread over the real ones.
 *
 * Only 'reserved' and 'consumed' count. 'draft' is a GRN still being typed and reserves nothing;
 * 'released' and 'reversed' have given their money back.
 */

export type BudgetCostCentreHeadRow = {
  head: string;
  subHead: string | null;
  budgeted: number;
  reserved: number;
  consumed: number;
  available: number;
};

export type BudgetCostCentreRow = {
  costCentreId: string | null;
  costCentreCode: string | null;
  costCentreName: string;
  /** True for the bucket holding GRN spend whose cost centre was never recorded. It is not a
   *  cost centre and must not be presented as one — it is a data-quality figure. */
  isUnattributed: boolean;
  budgeted: number;
  reserved: number;
  consumed: number;
  available: number;
  lineCount: number;
  heads: BudgetCostCentreHeadRow[];
};

const num = (value: unknown) => Number(value ?? 0);

/** Head + sub-head identity. Sub-head is nullable, and "" is a distinct value from NULL in the
 *  data, so both collapse to one key rather than producing two rows that read identically. */
const headKey = (head: string, subHead: string | null) => JSON.stringify([head, subHead]);

export const budgetCostCentreUtilizationService = {
  /** Branch of the budget, for the route's row-scope check before any figures are read. */
  async getBudgetBranch(budgetId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT branch_id FROM finance_budget_header WHERE id = ?`,
      [budgetId]
    );
    if (!rows[0]) {
      throw Object.assign(new Error("Budget not found"), {
        statusCode: 404,
        code: "BUDGET_NOT_FOUND",
      });
    }
    return String(rows[0].branch_id);
  },

  async get(budgetId: string): Promise<BudgetCostCentreRow[]> {
    // Budgeted, at (cost centre, head, sub-head) grain. `line_id` rides along so lineCount can be
    // a DISTINCT count — an allocated line appears once per cost centre it touches, and counting
    // rows instead of lines would inflate every branch-level budget's line count.
    const [budgetRows] = await db.query<RowDataPacket[]>(
      `SELECT cost_centre_id, head, sub_head, line_id, SUM(budgeted) AS budgeted
         FROM (
           SELECT l.cost_centre_id AS cost_centre_id, l.head AS head, l.sub_head AS sub_head,
                  l.id AS line_id, l.gross_amount AS budgeted
             FROM finance_budget_line l
            WHERE l.budget_id = ? AND l.cost_centre_id IS NOT NULL
           UNION ALL
           SELECT a.cost_centre_id, l.head, l.sub_head, l.id, a.gross_amount
             FROM finance_budget_line l
             JOIN finance_budget_line_allocation a ON a.budget_line_id = l.id
            WHERE l.budget_id = ? AND l.cost_centre_id IS NULL
         ) src
        GROUP BY cost_centre_id, head, sub_head, line_id`,
      [budgetId, budgetId]
    );

    // Measured spend. Joined back to the line so a GRN is attributed to the head/sub-head it was
    // budgeted under, and grouped on the GRN's OWN cost centre — which may differ from the line's.
    const [spendRows] = await db.query<RowDataPacket[]>(
      `SELECT g.cost_centre_id AS cost_centre_id, l.head AS head, l.sub_head AS sub_head,
              SUM(CASE WHEN g.lifecycle_status = 'reserved' THEN g.amount_with_tax ELSE 0 END) AS reserved,
              SUM(CASE WHEN g.lifecycle_status = 'consumed' THEN g.amount_with_tax ELSE 0 END) AS consumed
         FROM grn_cost_allocation g
         JOIN finance_budget_line l ON l.id = g.budget_line_id
        WHERE l.budget_id = ? AND g.lifecycle_status IN ('reserved', 'consumed')
        GROUP BY g.cost_centre_id, l.head, l.sub_head`,
      [budgetId]
    );

    const centreIds = new Set<string>();
    for (const row of [...budgetRows, ...spendRows]) {
      if (row.cost_centre_id != null) centreIds.add(String(row.cost_centre_id));
    }

    // Names are looked up in one pass rather than joined into both aggregates above, so a missing
    // master row cannot drop a cost centre that genuinely holds budget out of the report.
    const names = new Map<string, { code: string | null; name: string }>();
    if (centreIds.size) {
      const ids = [...centreIds];
      const [nameRows] = await db.query<RowDataPacket[]>(
        `SELECT id, cost_centre_code, cost_centre_name
           FROM cost_centre_master
          WHERE id IN (${ids.map(() => "?").join(",")})`,
        ids
      );
      for (const row of nameRows) {
        names.set(String(row.id), {
          code: row.cost_centre_code == null ? null : String(row.cost_centre_code),
          name: String(row.cost_centre_name ?? row.cost_centre_code ?? "Unnamed cost centre"),
        });
      }
    }

    const centres = new Map<string, BudgetCostCentreRow & { _heads: Map<string, BudgetCostCentreHeadRow>; _lines: Set<string> }>();

    const centreFor = (rawId: unknown) => {
      const id = rawId == null ? null : String(rawId);
      const key = id ?? "__unattributed__";
      let centre = centres.get(key);
      if (!centre) {
        const master = id ? names.get(id) : undefined;
        centre = {
          costCentreId: id,
          costCentreCode: master?.code ?? null,
          costCentreName: id
            ? master?.name ?? "Unknown cost centre"
            : "Unattributed (no cost centre on the GRN)",
          isUnattributed: !id,
          budgeted: 0,
          reserved: 0,
          consumed: 0,
          available: 0,
          lineCount: 0,
          heads: [],
          _heads: new Map(),
          _lines: new Set(),
        };
        centres.set(key, centre);
      }
      return centre;
    };

    const headFor = (centre: ReturnType<typeof centreFor>, head: string, subHead: string | null) => {
      const key = headKey(head, subHead);
      let row = centre._heads.get(key);
      if (!row) {
        row = { head, subHead, budgeted: 0, reserved: 0, consumed: 0, available: 0 };
        centre._heads.set(key, row);
      }
      return row;
    };

    for (const row of budgetRows) {
      const centre = centreFor(row.cost_centre_id);
      const head = String(row.head ?? "");
      const subHead = row.sub_head == null ? null : String(row.sub_head);
      const amount = num(row.budgeted);
      centre.budgeted += amount;
      centre._lines.add(String(row.line_id));
      headFor(centre, head, subHead).budgeted += amount;
    }

    for (const row of spendRows) {
      const centre = centreFor(row.cost_centre_id);
      const head = String(row.head ?? "");
      const subHead = row.sub_head == null ? null : String(row.sub_head);
      const reserved = num(row.reserved);
      const consumed = num(row.consumed);
      centre.reserved += reserved;
      centre.consumed += consumed;
      const headRow = headFor(centre, head, subHead);
      headRow.reserved += reserved;
      headRow.consumed += consumed;
    }

    const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

    return [...centres.values()]
      .map((centre) => {
        const heads = [...centre._heads.values()]
          .map((head) => ({
            ...head,
            budgeted: round(head.budgeted),
            reserved: round(head.reserved),
            consumed: round(head.consumed),
            available: round(head.budgeted - head.reserved - head.consumed),
          }))
          .sort((a, b) => b.budgeted - a.budgeted || a.head.localeCompare(b.head));
        return {
          costCentreId: centre.costCentreId,
          costCentreCode: centre.costCentreCode,
          costCentreName: centre.costCentreName,
          isUnattributed: centre.isUnattributed,
          budgeted: round(centre.budgeted),
          reserved: round(centre.reserved),
          consumed: round(centre.consumed),
          available: round(centre.budgeted - centre.reserved - centre.consumed),
          lineCount: centre._lines.size,
          heads,
        };
      })
      // Largest budget first; the unattributed bucket always last, because it is a data-quality
      // note rather than a cost centre competing for the reader's attention.
      .sort((a, b) => {
        if (a.isUnattributed !== b.isUnattributed) return a.isUnattributed ? 1 : -1;
        return b.budgeted - a.budgeted || a.costCentreName.localeCompare(b.costCentreName);
      });
  },
};
