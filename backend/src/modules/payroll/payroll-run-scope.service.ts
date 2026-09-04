/**
 * The set of cost centres a payroll run covers.
 *
 * A run used to mean "the whole company" — all 104 rows in salary_prep_run have branch_filter,
 * process_filter, branch_id and process_id NULL — so one blocked branch held up everybody. A scoped
 * run instead names its cost centres in salary_prep_run_scope, and this module owns validating that
 * selection and writing it.
 *
 * The rule that matters: a cost centre belongs to exactly one live run in a month. That is enforced
 * by UNIQUE (run_month, cost_centre_id) on the table itself. assertCostCentresFree() below checks
 * the same thing first, but only so the caller gets a message naming the clashing run instead of a
 * raw constraint violation — the key, not this check, is what makes double payment impossible.
 */

import type { PoolConnection } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { randomUUID } from "node:crypto";
import { db } from "../../db/mysql.js";

/**
 * The property MUST be `statusCode`, not `status`: middleware/errorHandler.ts reads `statusCode` and
 * masks anything else as a generic 500. Named `status` here, "this cost centre is already in a run"
 * would reach the user as "an unexpected server error occurred" — a refusal they could act on,
 * turned into one they could not.
 */
export class ScopeError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode = 400,
  ) {
    super(message);
    this.name = "ScopeError";
  }
}

export type ScopeRow = { costCentreId: string; branchId: string };

/**
 * Validate the selected cost centres and resolve each to its branch.
 *
 * The branch is resolved here rather than taken from the request. A client-supplied branch could
 * disagree with the cost centre's real one, and the scope row is what every later query trusts —
 * the readiness gate, the calculator, the register and the coverage report all read it.
 *
 * An empty selection is refused rather than treated as "no filter". A scoped run with no cost
 * centres would fall through to an unfiltered population, which is the whole company: the one
 * mistake here that pays thousands of people from a screen that said it was paying none.
 */
export async function resolveCostCentreScope(costCentreIds: string[]): Promise<ScopeRow[]> {
  const ids = [...new Set((costCentreIds ?? []).map((s) => String(s ?? "").trim()).filter(Boolean))];
  if (!ids.length) {
    throw new ScopeError("CC_REQUIRED", "Select at least one cost centre for a scoped payroll run.");
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ccm.id, ccm.branch_id
       FROM cost_centre_master ccm
       JOIN branch_master bm ON bm.id = ccm.branch_id AND bm.active_status = 1
      WHERE ccm.active_status = 1
        AND ccm.branch_id IS NOT NULL
        AND ccm.id IN (${ids.map(() => "?").join(",")})`,
    ids,
  );

  if (rows.length !== ids.length) {
    const found = new Set(rows.map((r) => String(r.id)));
    const missing = ids.filter((id) => !found.has(id));
    throw new ScopeError(
      "CC_NOT_FOUND",
      `Not active, or their branch is not active: ${missing.join(", ")}`,
    );
  }

  return rows.map((r) => ({ costCentreId: String(r.id), branchId: String(r.branch_id) }));
}

/**
 * Refuse cost centres already covered by a live run for this month.
 *
 * Cancelled runs are excluded: cancelling releases a run's scope rows, so its cost centres are free
 * again. Runs the payroll actually produced — including finalized and locked ones — hold their
 * claim, because their people have been paid.
 *
 * Takes the caller's connection rather than the pool, so the check runs inside the same advisory
 * lock and transaction as the insert that follows it. Checking on a pooled connection and
 * inserting on another is exactly how two runs both pass and both write.
 */
export async function assertCostCentresFree(
  conn: PoolConnection,
  runMonth: string,
  costCentreIds: string[],
): Promise<void> {
  if (!costCentreIds.length) return;

  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT s.cost_centre_id, s.run_id, ccm.cost_centre_code
       FROM salary_prep_run_scope s
       JOIN salary_prep_run r ON r.id = s.run_id
       LEFT JOIN cost_centre_master ccm ON ccm.id = s.cost_centre_id
      WHERE s.run_month = ?
        AND LOWER(r.status) <> 'cancelled'
        AND s.cost_centre_id IN (${costCentreIds.map(() => "?").join(",")})`,
    [runMonth, ...costCentreIds],
  );

  if (rows.length) {
    const names = rows.map((r) => String(r.cost_centre_code ?? r.cost_centre_id)).join(", ");
    throw new ScopeError(
      "CC_ALREADY_IN_RUN",
      `Already covered by another payroll run for ${runMonth}: ${names}`,
      409,
    );
  }
}

/** Write the run's scope. One statement, so a partial scope cannot survive a failure mid-loop. */
export async function insertRunScope(
  conn: PoolConnection,
  runId: string,
  runMonth: string,
  rows: ScopeRow[],
): Promise<void> {
  if (!rows.length) return;
  await conn.execute(
    `INSERT INTO salary_prep_run_scope (id, run_id, run_month, branch_id, cost_centre_id)
     VALUES ${rows.map(() => "(?, ?, ?, ?, ?)").join(", ")}`,
    rows.flatMap((r) => [randomUUID(), runId, runMonth, r.branchId, r.costCentreId]),
  );
}

export async function getRunScopeCostCentreIds(runId: string): Promise<string[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT cost_centre_id FROM salary_prep_run_scope WHERE run_id = ?`,
    [runId],
  );
  return rows.map((r) => String(r.cost_centre_id));
}
