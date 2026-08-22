import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { refuse } from "./finance-error.js";

/**
 * Branch-wide budget headroom gate — standalone module (Group C, step 1).
 *
 * Existing GRN budget checks (`branch-budget.service.ts`'s `availableLines()` / `getLineForGrn()`,
 * and the two large functions in `grn-smart.service.ts` that call them) gate on the ONE budget
 * line/cost-centre the raiser happens to pick. That is a recorded owner decision (2026-08-19,
 * "warn rather than block") which a later, separately reviewed task will reverse.
 *
 * This module is the new gate those call sites will eventually be wired to. It does not touch
 * any existing call site itself. The rule it implements: a GRN's head+sub-head should be checked
 * against budget aggregated across every budget line in the branch that shares that head+sub-head
 * — direct-to-a-cost-centre or pooled (`cost_centre_id IS NULL`) alike — not just the one line the
 * raiser picked. See `getHeadSubHeadCoverage` and `allocateAcrossLines` below.
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
  subHead: string | null
): Promise<{
  headerActive: boolean;
  lines: RowDataPacket[];
  aggregateAvailable: number;
}> {
  const [headerRows] = await db.execute<RowDataPacket[]>(
    `SELECT id
       FROM finance_budget_header
      WHERE branch_id = ?
        AND period_code = ?
        AND status = 'active'
      LIMIT 1`,
    [branchId, periodCode]
  );
  const header = headerRows[0];
  if (!header) {
    return { headerActive: false, lines: [], aggregateAvailable: 0 };
  }

  const [lines] = await db.execute<RowDataPacket[]>(
    `SELECT l.*,
            (l.quantity-l.reserved_quantity-l.consumed_quantity)
              AS available_quantity,
            (l.gross_amount-l.reserved_amount-l.consumed_amount)
              AS available_gross_amount
       FROM finance_budget_line l
       JOIN finance_budget_header h ON h.id = l.budget_id
      WHERE h.id = ?
        AND UPPER(TRIM(l.head)) = UPPER(TRIM(?))
        AND UPPER(TRIM(COALESCE(l.sub_head,''))) = UPPER(TRIM(COALESCE(?,'')))`,
    [header.id, head, subHead]
  );

  // A line that is somehow already over-consumed must not drag the aggregate below what other
  // lines genuinely have available, so each line's own contribution is clamped to >= 0 first.
  const aggregateAvailable = roundMoney(
    lines.reduce((sum, line) => sum + Math.max(0, Number(line.available_gross_amount)), 0)
  );

  return { headerActive: true, lines, aggregateAvailable };
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
  lines: RowDataPacket[]
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
    const draw = roundMoney(Math.min(available, remaining));
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
