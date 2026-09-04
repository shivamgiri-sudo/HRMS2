/**
 * Statutory and bank outputs across a whole payroll month.
 *
 * A month used to be one run, so "the run's ECR" and "the month's ECR" were the same document. Now
 * a month can be paid in several runs, one per group of cost centres — but PF, ESI, TDS and the
 * bank advice are still filed and paid once. Six runs must not produce six challans.
 *
 * The four affected endpoints therefore resolve a LIST of run ids and query `run_id IN (...)`. The
 * per-run and per-month URLs share one handler each, so the two can never drift into computing
 * contributions differently — which is the failure that would be discovered by a regulator rather
 * than by us.
 */

import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * Every run whose lines belong to this month's filing.
 *
 * Cancelled runs are excluded: their lines were never paid, and including them would overstate a
 * challan. Every other status counts — a run still in progress is money that will be paid this
 * month, and leaving it out would understate the liability instead.
 */
export async function getMonthRunIds(month: string): Promise<string[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM salary_prep_run
      WHERE run_month = ? AND LOWER(COALESCE(status, '')) <> 'cancelled'
      ORDER BY created_at`,
    [month],
  );
  return rows.map((r) => String(r.id));
}

/** `statusCode`, not `status` — see the note on ScopeError; errorHandler.ts only reads the former. */
export class MonthOutputError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode = 400,
  ) {
    super(message);
    this.name = "MonthOutputError";
  }
}

/**
 * The run ids an output request covers, from either URL shape.
 *
 * `/runs/:id/ecr` yields one id; `/month/2026-08/ecr` yields every run in that month. Returning a
 * list from both is what lets one handler serve both without a second copy of the query.
 *
 * A month with no runs is an error, not an empty document: an empty ECR looks exactly like a month
 * where nobody had PF, and filing that is worse than filing nothing.
 */
export async function resolveOutputRunIds(params: {
  runId?: string;
  month?: string;
}): Promise<{ runIds: string[]; month: string; scope: "run" | "month" }> {
  if (params.runId) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, run_month FROM salary_prep_run WHERE id = ? LIMIT 1`,
      [params.runId],
    );
    if (!rows.length) throw new MonthOutputError("RUN_NOT_FOUND", "Run not found", 404);
    return { runIds: [String(rows[0].id)], month: String(rows[0].run_month), scope: "run" };
  }

  const month = String(params.month ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new MonthOutputError("BAD_MONTH", "month must be YYYY-MM");
  }
  const runIds = await getMonthRunIds(month);
  if (!runIds.length) {
    throw new MonthOutputError("NO_RUNS", `No payroll runs exist for ${month}`, 404);
  }
  return { runIds, month, scope: "month" };
}

/** `IN (?, ?, …)` fragment for a resolved run-id list. Never interpolates the ids themselves. */
export function runIdPlaceholders(runIds: string[]): string {
  return runIds.map(() => "?").join(", ");
}
