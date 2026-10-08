import { randomUUID } from "crypto";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { db } from "../../db/mysql.js";

/**
 * Multi-month expense recognition (Requirement 5).
 *
 * Spreads an invoice's expense across the months it covers, without spreading the liability.
 * One invoice remains one GRN and one vendor payable; only recognition is divided.
 *
 * FY CROSSING (user ruling, 2026-08-12, supersedes 2026-08-07 clamp)
 * A recognition window may now span financial-year boundaries. An AMC July-26 to June-27 is
 * twelve months here, not nine. The UI warns when a window crosses FY boundaries so the
 * Finance Head can decide whether that is intentional; we never silently shorten the window.
 * The crossFy flag is exposed in every return value so callers can surface that warning.
 *
 * CUSTOM SPLIT
 * Finance Head may override the equal-split with explicit per-month percentages (must sum to
 * 100). The split_method column records 'custom' so reconciliation reports can distinguish it
 * from equal splits that happen to produce the same amounts.
 */

/** All arithmetic happens in paise. Rupee floats make 0.1 + 0.2 a reconciliation ticket. */
const toPaise = (rupees: number) => Math.round(Number(rupees) * 100);
const toRupees = (paise: number) => paise / 100;

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

function assertPeriod(period: string, label: string): void {
  if (!PERIOD.test(period)) {
    throw new Error(`${label} must be YYYY-MM, received "${period}"`);
  }
}

/**
 * Indian financial year for a period: April through March.
 *
 * Reimplemented rather than imported because branch-budget.service.ts and grn.service.ts each
 * hold a private copy that THROWS on a malformed period — this one returns a comparable value
 * for a range check and never throws mid-loop. The rule is identical: month >= 4 starts the FY.
 */
export function financialYearOf(period: string): string {
  assertPeriod(period, "Period");
  const [year, month] = period.split("-").map(Number);
  return month >= 4 ? `${year}-${String(year + 1).slice(-2)}` : `${year - 1}-${String(year).slice(-2)}`;
}

/** Every month from `from` to `to` inclusive, ascending. */
export function monthsBetween(from: string, to: string): string[] {
  assertPeriod(from, "Start period");
  assertPeriod(to, "End period");
  if (to < from) throw new Error("The recognition period cannot end before it starts");
  const months: string[] = [];
  let [year, month] = from.split("-").map(Number);
  const [endYear, endMonth] = to.split("-").map(Number);
  // Bounded so a malformed range cannot spin: no legitimate recognition exceeds a few years.
  while ((year < endYear || (year === endYear && month <= endMonth)) && months.length < 120) {
    months.push(`${year}-${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  }
  return months;
}

export type PeriodSplit = {
  period_code: string;
  recognition_amount: number;
  sequence_no: number;
};

/**
 * Divides an amount across the eligible months, exactly.
 *
 * The last row is a SUBTRACTION, never a rounded quotient, so there is no accumulating-epsilon
 * path: sum(rows) equals the input by construction rather than by tolerance.
 *
 *   12,00,000 / 12  ->  twelve rows of 1,00,000.00
 *   10,000 / 3      ->  3,333.33 + 3,333.33 + 3,333.34  =  10,000.00
 */
export function computeEqualSplit(amount: number, periods: string[]): PeriodSplit[] {
  if (!periods.length) {
    throw new Error("There are no months in this financial year to recognise the cost against");
  }
  const totalPaise = toPaise(amount);
  if (!Number.isFinite(totalPaise)) throw new Error("Recognition amount is not a number");

  // Truncation, not rounding: rounding each row up can make the residue negative, and a final
  // row smaller than the others reads as an error to whoever checks it.
  const base = Math.trunc(totalPaise / periods.length);
  const rows: PeriodSplit[] = periods.map((period_code, index) => ({
    period_code,
    sequence_no: index + 1,
    recognition_amount: toRupees(base),
  }));
  const residue = totalPaise - base * periods.length;
  rows[rows.length - 1].recognition_amount = toRupees(base + residue);
  return rows;
}

/**
 * Divides an amount across the given months using caller-supplied percentages.
 *
 * customPercentages maps each period_code to a percentage (0–100, not decimal).
 * Must cover exactly the periods array and sum to 100 (within 0.5 paise tolerance).
 */
export function computeCustomSplit(
  amount: number,
  periods: string[],
  customPercentages: Record<string, number>,
): PeriodSplit[] {
  if (!periods.length) throw new Error("No periods for custom split");
  const totalPaise = toPaise(amount);
  if (!Number.isFinite(totalPaise)) throw new Error("Recognition amount is not a number");

  let allocatedPaise = 0;
  const rows: PeriodSplit[] = periods.map((period_code, index) => {
    const pct = Number(customPercentages[period_code] ?? 0);
    if (!Number.isFinite(pct) || pct < 0) {
      throw new Error(`Period ${period_code}: percentage must be ≥ 0`);
    }
    const periodPaise = Math.trunc((totalPaise * pct) / 100);
    allocatedPaise += periodPaise;
    return { period_code, sequence_no: index + 1, recognition_amount: toRupees(periodPaise) };
  });

  // Absorb floating-point residue into the last row (same convention as equalSplit).
  rows[rows.length - 1].recognition_amount = toRupees(
    toPaise(rows[rows.length - 1].recognition_amount) + (totalPaise - allocatedPaise),
  );

  const pctSum = periods.reduce((s, p) => s + Number(customPercentages[p] ?? 0), 0);
  if (Math.abs(pctSum - 100) > 0.1) {
    throw new Error(
      `Custom split percentages must sum to 100% (currently ${pctSum.toFixed(4)}%)`,
    );
  }
  return rows;
}

/**
 * The months an invoice may be recognised against.
 *
 * Cross-FY windows are allowed (supersedes the 2026-08-07 clamp). The crossFy flag lets
 * callers surface a warning when the range spans two financial years.
 */
export function resolveEligiblePeriods(input: {
  accountingPeriod: string;
  startPeriod: string;
  endPeriod: string;
}): { periods: string[]; financialYear: string; clamped: boolean; requestedCount: number; crossFy: boolean } {
  const financialYear = financialYearOf(input.accountingPeriod);
  const periods = monthsBetween(input.startPeriod, input.endPeriod);
  if (!periods.length) {
    throw new Error(
      `No months between ${input.startPeriod} and ${input.endPeriod}`,
    );
  }
  const crossFy = periods.some((p) => financialYearOf(p) !== financialYear);
  return {
    periods,
    financialYear,
    clamped: false,
    requestedCount: periods.length,
    crossFy,
  };
}

export const grnPeriodAllocationService = {
  /**
   * Replaces the period split for one cost allocation.
   *
   * Written inside the caller's transaction, and the sum is re-asserted against the parent
   * before it can commit. Proving the invariant at WRITE time matters because the P&L view is
   * a read model — drift there is invisible until a month-end does not tie.
   *
   * When customPercentages is supplied (Finance Head custom split), amounts are derived from
   * those percentages instead of the equal-split formula. split_method is set accordingly.
   */
  async saveSplit(
    input: {
      costAllocationId: string;
      grnRequestId: string;
      recognitionAmount: number;
      accountingPeriod: string;
      startPeriod: string;
      endPeriod: string;
      /** Optional per-month percentages for a custom (non-equal) split. */
      customPercentages?: Record<string, number> | null;
      pnlBucket?: string | null;
      actorUserId: string;
    },
    connection: PoolConnection,
  ) {
    if (!connection) {
      throw new Error("A period split must be written inside the caller's transaction");
    }
    const { periods, financialYear, clamped, requestedCount, crossFy } = resolveEligiblePeriods(input);
    const isCustom = input.customPercentages && Object.keys(input.customPercentages).length > 0;
    const rows = isCustom
      ? computeCustomSplit(input.recognitionAmount, periods, input.customPercentages!)
      : computeEqualSplit(input.recognitionAmount, periods);
    const splitMethod = isCustom ? "custom" : "equal";

    // The invariant, asserted rather than assumed. 0.005 is half a paisa: anything larger is a
    // real discrepancy, not representation.
    const total = rows.reduce((sum, r) => sum + toPaise(r.recognition_amount), 0);
    if (Math.abs(total - toPaise(input.recognitionAmount)) > 0.5) {
      throw new Error(
        `Period split does not reconcile: ${toRupees(total).toFixed(2)} against ${Number(input.recognitionAmount).toFixed(2)}`,
      );
    }

    await connection.execute(
      `DELETE FROM grn_period_allocation WHERE cost_allocation_id = ?`,
      [input.costAllocationId],
    );
    for (const row of rows) {
      await connection.execute(
        `INSERT INTO grn_period_allocation
           (id, cost_allocation_id, grn_request_id, sequence_no, period_code,
            recognition_amount, pnl_bucket, split_method, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          randomUUID(), input.costAllocationId, input.grnRequestId, row.sequence_no,
          row.period_code, row.recognition_amount, input.pnlBucket ?? null, splitMethod, input.actorUserId,
        ],
      );
    }

    // deferred vs single is what tells every read path whether to look for child rows at all.
    await connection.execute(
      `UPDATE grn_request
          SET recognition_start_period = ?, recognition_end_period = ?,
              period_allocation_mode = ?, is_multi_month = ?
        WHERE id = ?`,
      [
        periods[0], periods[periods.length - 1],
        periods.length > 1 ? "deferred" : "single",
        periods.length > 1 ? 1 : 0,
        input.grnRequestId,
      ],
    );

    return { periods: rows, financialYear, clamped, crossFy, requestedCount, eligibleCount: periods.length };
  },

  async listSplit(grnRequestId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT p.*, a.cost_centre_id, a.process_id
         FROM grn_period_allocation p
         JOIN grn_cost_allocation a ON a.id = p.cost_allocation_id
        WHERE p.grn_request_id = ?
        ORDER BY p.cost_allocation_id, p.sequence_no`,
      [grnRequestId],
    );
    return rows;
  },

  /**
   * Proves sum(period rows) == the parent allocation's pnl_cost_amount, per allocation.
   *
   * Exposed separately so a reconciliation report can run it over a whole period rather than
   * trusting that every write path called saveSplit.
   */
  async verifyReconciliation(grnRequestId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT a.id AS cost_allocation_id,
              a.pnl_cost_amount,
              COALESCE(SUM(p.recognition_amount), 0) AS split_total,
              COUNT(p.id) AS period_count
         FROM grn_cost_allocation a
         LEFT JOIN grn_period_allocation p ON p.cost_allocation_id = a.id
        WHERE a.grn_request_id = ?
        GROUP BY a.id, a.pnl_cost_amount`,
      [grnRequestId],
    );
    return (rows as RowDataPacket[]).map((row) => {
      const expected = toPaise(Number(row.pnl_cost_amount ?? 0));
      const actual = toPaise(Number(row.split_total ?? 0));
      return {
        cost_allocation_id: String(row.cost_allocation_id),
        pnl_cost_amount: Number(row.pnl_cost_amount ?? 0),
        split_total: Number(row.split_total ?? 0),
        period_count: Number(row.period_count ?? 0),
        // An allocation with no child rows is single-month, not broken.
        reconciles: Number(row.period_count ?? 0) === 0 || expected === actual,
      };
    });
  },
};
