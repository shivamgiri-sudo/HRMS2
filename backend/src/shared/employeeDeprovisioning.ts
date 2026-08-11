import { db } from "../db/mysql.js";
import type { ResultSetHeader, RowDataPacket } from "mysql2";

export interface DeprovisionResult {
  lmsMappingsRevoked: number;
  leaveRequestsCancelled: number;
  /** Reported, not mutated - see the asset note below. */
  openAssetAssignments: number;
  failures: string[];
}

/**
 * Withdraw the entitlements that outlive a departure: LMS access, future leave,
 * and a count of kit still out on loan.
 *
 * This existed inside exit.service's `exited` branch and **none of it worked.**
 * All three statements named schema that does not exist, and each was wrapped in
 * a `.catch()` that logged a warning and let the exit report success:
 *
 *   - `UPDATE employee_asset_assignment ... SET return_status` - no such table.
 *     The real one is `asset_assignment`, and it has no `return_status` column.
 *   - `UPDATE lms_employee_mapping SET active_status = 0, deprovisioned_at,
 *     deprovisioned_reason` - the column is `is_active`; the other two do not
 *     exist. Measured 2026-08-11: **60 people who have left are still active
 *     learners.**
 *   - `UPDATE leave_requests SET ... updated_at, cancellation_reason` - the
 *     table is `leave_request` (singular) and has neither column. 2,185
 *     pending/approved rows are held by people who have already left.
 *
 * So every exit silently skipped its own cleanup. Failures are collected and
 * returned here rather than swallowed, so a caller can report what did not
 * happen instead of assuming it did.
 *
 * Non-throwing: this runs after a deactivation that is already committed, and
 * must never roll it back or 500 the request.
 */
export async function deprovisionEmployeeAccess(
  employeeId: string,
  reason: string
): Promise<DeprovisionResult> {
  const result: DeprovisionResult = {
    lmsMappingsRevoked: 0,
    leaveRequestsCancelled: 0,
    openAssetAssignments: 0,
    failures: [],
  };

  const step = async (label: string, run: () => Promise<void>) => {
    try {
      await run();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.failures.push(`${label}: ${message}`);
      process.stderr.write(
        JSON.stringify({
          level: "error",
          module: "employeeDeprovisioning",
          event: "DEPROVISION_STEP_FAILED",
          step: label,
          employee_id: employeeId,
          reason,
          error: message,
          timestamp: new Date().toISOString(),
        }) + "\n"
      );
    }
  };

  // LMS access. The deployed LMS is a separate system of record; this mapping is
  // what HRMS controls, and marking it inactive is the documented deprovisioning
  // hook. There is no deprovisioned_at/_reason column to write the why into.
  await step("lms", async () => {
    const [res] = await db.execute<ResultSetHeader>(
      "UPDATE lms_employee_mapping SET is_active = 0 WHERE employee_id = ? AND is_active = 1",
      [employeeId]
    );
    result.lmsMappingsRevoked = res?.affectedRows ?? 0;
  });

  // Leave that has not started yet.
  //
  // Deliberately NOT every pending/approved row, which is what the original
  // intended. Leave whose dates have already passed has been consumed - it is
  // reflected in attendance and may already have been paid - so cancelling it
  // retroactively would rewrite settled history and diverge from payroll. Only
  // future-dated requests are withdrawn. Both the legacy (from_date/to_date) and
  // current (start_date/end_date) column pairs are populated, hence COALESCE.
  await step("leave", async () => {
    const [res] = await db.execute<ResultSetHeader>(
      `UPDATE leave_request
          SET status = 'cancelled'
        WHERE employee_id = ?
          AND status IN ('pending', 'approved')
          AND COALESCE(start_date, from_date) > CURDATE()`,
      [employeeId]
    );
    result.leaveRequestsCancelled = res?.affectedRows ?? 0;
  });

  // Assets are counted, not mutated.
  //
  // `asset_assignment` records a return with `returned_date`/`return_condition`
  // and has no "return pending" flag. Writing a returned_date would assert the
  // kit is back when nobody has seen it, so this reports the number still out
  // and leaves the record honest. Flagging properly needs a schema change, which
  // is a separate, approved decision.
  await step("assets", async () => {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM asset_assignment WHERE employee_id = ? AND returned_date IS NULL",
      [employeeId]
    );
    result.openAssetAssignments = Number((rows[0] as { n: unknown } | undefined)?.n ?? 0);
  });

  return result;
}
