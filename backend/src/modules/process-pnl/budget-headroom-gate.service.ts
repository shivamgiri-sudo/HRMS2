import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { refuse } from "./finance-error.js";
import { budgetCostRatio } from "./budget-tax-basis.js";

/** The narrowest thing both the pool wrapper and a `PoolConnection` satisfy. Their `execute`
 *  overloads differ enough that `Pick<typeof db, "execute">` rejects a connection outright, which
 *  is the one caller that most needs to pass one. */
type SqlExecutor = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  execute(sql: string, params?: any[]): Promise<any>;
};

/**
 * Branch-wide budget headroom gate — standalone module (Group C, step 1).
 *
 * GRN budget checks used to gate on the ONE budget line the raiser happened to pick — a recorded
 * owner decision of 2026-08-19, "warn rather than block". This module reversed it.
 *
 * The rule: a GRN's head+sub-head is checked against budget aggregated across every budget line in
 * the branch that shares that head+sub-head — direct-to-a-cost-centre or pooled
 * (`cost_centre_id IS NULL`) alike — not just the one line the raiser picked. A row whose own line
 * is short spills onto siblings; a row the whole branch cannot cover is refused.
 *
 * Every GRN gate now runs through it, so a raiser gets the same answer at every step:
 *   grn.service.ts        createDraft() and createUnbudgetedDraft()
 *   grn-smart.service.ts  saveAllocations(), saveComponentAllocations(), reserveAllocations()
 *
 * A consequence worth stating plainly, because it is the whole point: the line that funds a row
 * and the cost centre that bears it are now different facts, recorded in different columns
 * (`funding_cost_centre_id`, migration 1630). Cost centre A with no line of its own for a
 * head/sub-head is funded from cost centre B's line and still carries the cost.
 */

function roundMoney(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/**
 * Every active budget line in `branchId`/`periodCode` whose head+sub-head matches, and the
 * branch-wide available amount across all of them combined.
 *
 * Head/sub-head are free-text columns (not FK'd), so the match is case/whitespace-insensitive on
 * both sides. Deliberately does NOT filter on `cost_centre_id` — a direct line and a pooled line
 * for the same head+sub-head both count toward the branch aggregate.
 */
export async function getHeadSubHeadCoverage(
  branchId: string,
  periodCode: string,
  head: string,
  subHead: string | null,
  /**
   * Read on the CALLER'S transaction when one is passed.
   *
   * The pool default is right for a read that only informs a later decision. It is wrong for a
   * caller that has already moved money inside its own transaction — reserving at Branch Head
   * approval, where two allocations of the same GRN can each need re-funding — because a pooled
   * read cannot see this transaction's own uncommitted reservations and would hand the second row
   * headroom the first row has already taken.
   */
  executor: SqlExecutor = db
): Promise<{
  headerActive: boolean;
  /** The active budget header's id, so a caller can run the sub-head closure check without a
   *  second lookup. Null only when `headerActive` is false. */
  budgetId: string | null;
  lines: RowDataPacket[];
  aggregateAvailable: number;
}> {
  const [headerRows] = (await executor.execute(
    `SELECT id
       FROM finance_budget_header
      WHERE branch_id = ?
        AND period_code = ?
        AND status = 'active'
      LIMIT 1`,
    [branchId, periodCode]
  )) as [RowDataPacket[], unknown];
  const header = headerRows[0];
  if (!header) {
    return { headerActive: false, budgetId: null, lines: [], aggregateAvailable: 0 };
  }

  /*
   * The budget line's head is resolved through finance_expense_head_master before comparison.
   *
   * `finance_budget_line.head` is free text and holds whichever of head_code or head_name the
   * budget happened to be created with. A line stored as "ELECTRICITY" and a GRN raised as
   * "Electricity" are the same head that a raw UPPER(TRIM()) comparison calls different — and the
   * raiser would be told NO_BUDGET_FOR_HEAD against budget that plainly exists.
   *
   * Only the LINE side needs resolving, not the query side. Every producer of `head` here already
   * supplies a head_name: the GRN form normalises through its own headCodeToName map before
   * posting, and grn.service.ts reads it straight off the budget line it locked. Normalising both
   * sides would mean a second placeholder inside a JOIN clause, which puts it ahead of the
   * header id in the parameter list for no gain.
   *
   * All 21 heads on live budget lines currently store head_name, so no existing match changes;
   * this closes the case before it happens rather than after.
   */
  const [lines] = (await executor.execute(
    `SELECT l.*,
            (l.quantity-l.reserved_quantity-l.consumed_quantity)
              AS available_quantity,
            (l.pnl_cost_amount-l.reserved_amount-l.consumed_amount)
              AS available_gross_amount
       FROM finance_budget_line l
       JOIN finance_budget_header h ON h.id = l.budget_id
       LEFT JOIN finance_expense_head_master lm
              ON UPPER(TRIM(lm.head_code)) = UPPER(TRIM(l.head))
      WHERE h.id = ?
        AND UPPER(TRIM(COALESCE(lm.head_name, l.head))) = UPPER(TRIM(?))
        AND UPPER(TRIM(COALESCE(l.sub_head,''))) = UPPER(TRIM(COALESCE(?,'')))`,
    [header.id, head, subHead]
  )) as [RowDataPacket[], unknown];

  // A line that is somehow already over-consumed must not drag the aggregate below what other
  // lines genuinely have available, so each line's own contribution is clamped to >= 0 first.
  const aggregateAvailable = roundMoney(
    lines.reduce((sum, line) => sum + Math.max(0, Number(line.available_gross_amount)), 0)
  );

  return { headerActive: true, budgetId: String(header.id), lines, aggregateAvailable };
}

/**
 * The most invoice GROSS this coverage can carry, given the invoice's own taxable value.
 *
 * `aggregateAvailable` is a sum of budget, and budget is not interchangeable with invoice gross on
 * a `non_gst` or `exempt` line — see `allocateAcrossLines`'s `netAmount`. A caller comparing a
 * tax-inclusive invoice against the raw aggregate refuses invoices that fit; this converts the
 * aggregate into the same units as the number being checked.
 */
export function absorbableGrossFor(
  coverage: { lines: RowDataPacket[] },
  grossAmount: number,
  netAmount?: number
): number {
  return roundMoney(
    coverage.lines.reduce((sum, line) => {
      const available = Math.max(0, Number(line.available_gross_amount));
      if (available <= 0) return sum;
      const costRatio = budgetCostRatio(line.tax_treatment, grossAmount, netAmount);
      return sum + (costRatio > 0 ? available / costRatio : available);
    }, 0)
  );
}

/**
 * The two refusals every GRN gate raises before it can even look at headroom, in one place.
 *
 * `getHeadSubHeadCoverage` reports "no active budget for this branch/month" and "no line anywhere
 * in the branch for this head/sub-head" as plain return values, and each call site was
 * re-deriving the same pair of 409s from them. Create, allocation-save and component-save now all
 * go through this so a raiser gets the same message whichever step they hit it on — they used to
 * get a single-line "GRN amount exceeds the available approved budget" at create and a
 * branch-aggregate answer one step later.
 */
export function assertCoverageExists(
  coverage: { headerActive: boolean; lines: RowDataPacket[] },
  periodCode: string,
  head: string,
  subHead: string | null,
  rowLabel?: string
): void {
  const prefix = rowLabel ? `${rowLabel}: ` : "";
  if (!coverage.headerActive) {
    throw refuse(
      409,
      "NO_BRANCH_BUDGET",
      `${prefix}No approved budget exists for this branch for ${periodCode}. A GRN cannot be raised until one is approved.`
    );
  }
  if (!coverage.lines.length) {
    throw refuse(
      409,
      "NO_BUDGET_FOR_HEAD",
      `${prefix}${head}/${subHead || ""} has no budget anywhere in this branch. Raise a budget addition request before submitting this GRN.`
    );
  }
}

/**
 * Splits `amount` (money only — see note below) across `lines`, greedily.
 *
 * Pure function — no DB access, no `async`. Deliberately operates on amount only, not quantity:
 * quantity semantics differ too much between the two real call sites this will eventually feed
 * (one has physical unit quantities tied to a specific line's own unit rate, the other derives a
 * synthetic accounting quantity from `componentAmount / lineUnitRate`) for a shared pure function
 * to handle correctly. Each call site re-derives its own quantity/tax breakdown per line it is
 * actually allocated against, using that line's own real `unit_rate`, the way the existing code
 * already does per-line via `calculateBudgetLine(...)`. This function only decides the money split.
 *
 * Draw order: the preferred line first (if given and present in `lines`), then every remaining
 * line with a direct `cost_centre_id` before any pooled (`cost_centre_id IS NULL`) line, and
 * within each of those two groups by `available_gross_amount` descending — pooled lines are the
 * last-resort shared buffer.
 *
 * `NO_BRANCH_BUDGET` / `NO_BUDGET_FOR_HEAD` are the caller's responsibility (based on
 * `getHeadSubHeadCoverage`'s `headerActive`/`lines.length`) — this function only ever sees a call
 * site that has already confirmed lines exist, so its only failure mode is `HEADROOM_EXCEEDED`,
 * which also covers an empty `lines` array (nothing to allocate from is the same failure as
 * insufficient total headroom, not a separate case).
 */
export function allocateAcrossLines(
  preferredLineId: string | null,
  amount: number,
  lines: RowDataPacket[],
  /**
   * The invoice's TAXABLE value for the same `amount`, when it is known.
   *
   * Without it this function charged every line the tax-inclusive figure, including lines planned
   * as `non_gst` or `exempt` whose `gross_amount` is net of tax. That compares unlike things and
   * it refused real invoices: a Rs 21,000 non-taxable budget line could not carry a Rs 21,000
   * invoice whose taxable value was Rs 17,796, because the gate weighed the GST against a plan
   * that never contained any. `reserve()` has charged those lines on the taxable value since
   * consumptionBasis() was written; this gate had not learned the same rule, so a GRN was refused
   * at save with HEADROOM_EXCEEDED for money that Branch Head approval would have accepted.
   *
   * Optional, and 1:1 when omitted, so any caller that cannot supply it keeps the old behaviour.
   */
  netAmount?: number
): Array<{ lineId: string; amount: number }> {
  const isPreferred = (line: RowDataPacket) =>
    preferredLineId != null && String(line.id) === String(preferredLineId);

  const preferred = lines.filter(isPreferred);
  const rest = lines
    .filter((line) => !isPreferred(line))
    .sort((a, b) => {
      const aPooled = a.cost_centre_id == null;
      const bPooled = b.cost_centre_id == null;
      if (aPooled !== bPooled) return aPooled ? 1 : -1; // direct lines before pooled lines
      return Number(b.available_gross_amount) - Number(a.available_gross_amount);
    });

  const ordered = [...preferred, ...rest];

  let remaining = roundMoney(amount);
  const draws: Array<{ lineId: string; amount: number }> = [];
  const EPSILON = 0.01;

  for (const line of ordered) {
    if (remaining <= EPSILON) break;
    const available = Math.max(0, Number(line.available_gross_amount));
    if (available <= 0) continue;
    /*
     * How much INVOICE GROSS this line can absorb, which is not the same as how much budget it
     * has left. On a non-taxable line one rupee of budget carries more than one rupee of invoice,
     * because the GST on that invoice is never charged to it — the same conversion reserve() does
     * through consumptionBasis(), applied here so both gates agree on what fits.
     */
    const costRatio = budgetCostRatio(line.tax_treatment, amount, netAmount);
    const absorbableGross = costRatio > 0 ? available / costRatio : available;
    const draw = roundMoney(Math.min(absorbableGross, remaining));
    if (draw <= 0) continue;
    draws.push({ lineId: String(line.id), amount: draw });
    remaining = roundMoney(remaining - draw);
  }

  if (remaining > EPSILON) {
    const shortfall = roundMoney(remaining);
    throw Object.assign(
      refuse(
        409,
        "HEADROOM_EXCEEDED",
        `Requested amount exceeds available budget for this head/sub-head across the branch by ₹${shortfall.toFixed(2)}`
      ),
      { shortfall }
    );
  }

  return draws;
}
