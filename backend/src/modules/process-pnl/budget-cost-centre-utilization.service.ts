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
 *
 * FUNDED-ELSEWHERE, added 2026-08-29
 * -----------------------------------
 * Since the branch-wide headroom gate (2026-08-22), the cost centre a GRN is attributed to
 * (`cost_centre_id`, who incurred it — what this whole file already reports) and the cost centre
 * whose budget line actually paid for it (`funding_cost_centre_id`, migration 1630) are routinely
 * different: cost centre A with no line of its own for a head/sub-head is funded from cost centre
 * B's line and still carries the cost on A's own row here. Every P&L-facing query in this module
 * was checked and NONE of them read `funding_cost_centre_id` at all — not a double-count (each
 * allocation row is summed once, on `cost_centre_id`, exactly as it always was), but a real loss
 * of the one fact migration 1630 exists to preserve: which budget actually absorbed the money.
 *
 * `fundedElsewhere` is additive, not a new total: it is the portion of THIS row's own
 * reserved+consumed whose `funding_cost_centre_id` differs from `cost_centre_id` (funded by a
 * named sibling centre) or is NULL on a real allocation (funded from the branch-common pool).
 * `budgeted`/`reserved`/`consumed`/`available` above are completely unchanged by this addition —
 * a reader who ignores the new field sees exactly the report that existed before it.
 */

export type BudgetCostCentreHeadRow = {
  head: string;
  subHead: string | null;
  budgeted: number;
  reserved: number;
  consumed: number;
  available: number;
};

/** One OTHER budget that funded part of this cost centre's spend — a named sibling cost centre,
 *  or the branch-common pool when the funding line has no owning cost centre of its own. */
export type FundingSourceRow = {
  /** Null means the branch-common pool (a pooled/branch-level line), not "unknown". */
  costCentreId: string | null;
  costCentreName: string;
  reserved: number;
  consumed: number;
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
  /** Portion of reserved+consumed above whose funding_cost_centre_id differs from this row's own
   *  cost_centre_id (or is NULL on a real allocation — the branch pool). Additive, not a new
   *  total: reserved/consumed already include this money: it always did, under the old
   *  attribution-only view. This says how much of it this cost centre's OWN budget did not pay
   *  for. Zero for every row until a GRN actually spills across cost centres or draws the pool. */
  fundedElsewhere: { reserved: number; consumed: number };
  /** Broken down by who actually funded it, for the row above. Empty when fundedElsewhere is 0. */
  fundingSources: FundingSourceRow[];
  lineCount: number;
  heads: BudgetCostCentreHeadRow[];
};

/** Budget lines planned at branch level (cost_centre_id IS NULL) with no allocation rows in
 *  finance_budget_line_allocation. Their budgeted amounts cannot be attributed to any cost centre
 *  and are therefore invisible in the per-CC view. Returned as metadata so the UI can surface a
 *  warning rather than silently under-reporting the branch's total budget. */
export type UnallocatedBranchLineSummary = {
  lineCount: number;
  totalBudget: number;
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

  async get(budgetId: string): Promise<{ rows: BudgetCostCentreRow[]; unallocated: UnallocatedBranchLineSummary }> {
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

    // Same rows as spendRows, split out where funding_cost_centre_id names a DIFFERENT centre
    // than cost_centre_id (a sibling's budget paid) or is NULL (the branch pool paid) — see this
    // file's own "FUNDED-ELSEWHERE" banner above. Deliberately a separate query rather than an
    // extra column on spendRows: this one is grouped by (incurring centre, FUNDING centre) so the
    // per-source breakdown below can be built directly, and it only ever contains the subset that
    // actually spilled — most cost centres will have zero rows here.
    const [fundedElsewhereRows] = await db.query<RowDataPacket[]>(
      `SELECT g.cost_centre_id AS cost_centre_id, g.funding_cost_centre_id AS funding_cost_centre_id,
              SUM(CASE WHEN g.lifecycle_status = 'reserved' THEN g.amount_with_tax ELSE 0 END) AS reserved,
              SUM(CASE WHEN g.lifecycle_status = 'consumed' THEN g.amount_with_tax ELSE 0 END) AS consumed
         FROM grn_cost_allocation g
         JOIN finance_budget_line l ON l.id = g.budget_line_id
        WHERE l.budget_id = ?
          AND g.lifecycle_status IN ('reserved', 'consumed')
          AND g.budget_line_id IS NOT NULL
          AND (g.funding_cost_centre_id IS NULL
               OR g.funding_cost_centre_id <> g.cost_centre_id
               OR g.cost_centre_id IS NULL)
        GROUP BY g.cost_centre_id, g.funding_cost_centre_id`,
      [budgetId]
    );

    // Simple GRNs: budget lines that are pinned to a specific cost centre but whose spend was
    // tracked ONLY in finance_budget_line.reserved_amount / consumed_amount (the simple GRN path
    // via budgetConsumptionService) with NO grn_cost_allocation rows written. Without this, the
    // CC tab's consumed column reads zero for those lines while the variance tab correctly shows
    // the line's consumed_amount, producing a visible discrepancy for direct-CC budget lines.
    const [simpleGrnRows] = await db.query<RowDataPacket[]>(
      `SELECT l.cost_centre_id, l.head, l.sub_head,
              l.reserved_amount AS reserved,
              l.consumed_amount AS consumed
         FROM finance_budget_line l
        WHERE l.budget_id = ?
          AND l.cost_centre_id IS NOT NULL
          AND (l.reserved_amount > 0 OR l.consumed_amount > 0)
          AND NOT EXISTS (
            SELECT 1 FROM grn_cost_allocation g
             WHERE g.budget_line_id = l.id
               AND g.lifecycle_status IN ('reserved', 'consumed')
          )`,
      [budgetId]
    );

    // How much branch-level budget is completely invisible in this per-CC view because no
    // finance_budget_line_allocation rows were written for it.
    const [unallocatedRows] = await db.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt, COALESCE(SUM(l.gross_amount), 0) AS total_budget
         FROM finance_budget_line l
        WHERE l.budget_id = ?
          AND l.cost_centre_id IS NULL
          AND l.gross_amount > 0
          AND NOT EXISTS (
            SELECT 1 FROM finance_budget_line_allocation a WHERE a.budget_line_id = l.id
          )`,
      [budgetId]
    );
    const unallocated: UnallocatedBranchLineSummary = {
      lineCount: Number(unallocatedRows[0]?.cnt ?? 0),
      totalBudget: Number(unallocatedRows[0]?.total_budget ?? 0),
    };

    const centreIds = new Set<string>();
    for (const row of [...budgetRows, ...spendRows, ...simpleGrnRows]) {
      if (row.cost_centre_id != null) centreIds.add(String(row.cost_centre_id));
    }
    // funding_cost_centre_id names a centre that may hold no BUDGET on this header at all (it
    // funded from a line that could belong to any active cost centre in the branch) — collected
    // separately so its name is still resolved even when it never appears as an incurring centre.
    for (const row of fundedElsewhereRows) {
      if (row.funding_cost_centre_id != null) centreIds.add(String(row.funding_cost_centre_id));
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

    const centres = new Map<string, BudgetCostCentreRow & {
      _heads: Map<string, BudgetCostCentreHeadRow>;
      _lines: Set<string>;
      _fundingSources: Map<string, FundingSourceRow>;
    }>();

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
          fundedElsewhere: { reserved: 0, consumed: 0 },
          fundingSources: [],
          lineCount: 0,
          heads: [],
          _heads: new Map(),
          _lines: new Set(),
          _fundingSources: new Map<string, FundingSourceRow>(),
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

    // Simple GRN fallback: direct-CC lines whose spend is only in the budget line columns.
    // These are NOT double-counted with spendRows: the EXISTS NOT check in the query above
    // guarantees a line is in simpleGrnRows only when spendRows has zero rows for it.
    for (const row of simpleGrnRows) {
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

    // fundedElsewhere: additive on top of the centre.reserved/consumed already accumulated above
    // from spendRows — this does not add new money, it labels a portion of what is already there.
    for (const row of fundedElsewhereRows) {
      const centre = centreFor(row.cost_centre_id);
      const reserved = num(row.reserved);
      const consumed = num(row.consumed);
      centre.fundedElsewhere.reserved += reserved;
      centre.fundedElsewhere.consumed += consumed;

      const fundingId = row.funding_cost_centre_id == null ? null : String(row.funding_cost_centre_id);
      const sourceKey = fundingId ?? "__pool__";
      let source = centre._fundingSources.get(sourceKey);
      if (!source) {
        source = {
          costCentreId: fundingId,
          costCentreName: fundingId
            ? (names.get(fundingId)?.name ?? "Unknown cost centre")
            : "Branch-common pool",
          reserved: 0,
          consumed: 0,
        };
        centre._fundingSources.set(sourceKey, source);
      }
      source.reserved += reserved;
      source.consumed += consumed;
    }

    const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

    const rows = [...centres.values()]
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
        const fundingSources = [...centre._fundingSources.values()]
          .map((source) => ({ ...source, reserved: round(source.reserved), consumed: round(source.consumed) }))
          .sort((a, b) => (b.reserved + b.consumed) - (a.reserved + a.consumed));
        return {
          costCentreId: centre.costCentreId,
          costCentreCode: centre.costCentreCode,
          costCentreName: centre.costCentreName,
          isUnattributed: centre.isUnattributed,
          budgeted: round(centre.budgeted),
          reserved: round(centre.reserved),
          consumed: round(centre.consumed),
          available: round(centre.budgeted - centre.reserved - centre.consumed),
          fundedElsewhere: {
            reserved: round(centre.fundedElsewhere.reserved),
            consumed: round(centre.fundedElsewhere.consumed),
          },
          fundingSources,
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
    return { rows, unallocated };
  },
};
