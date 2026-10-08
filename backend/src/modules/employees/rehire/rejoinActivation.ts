import type { RowDataPacket } from "mysql2";
import { evaluateRehire, type RehireVerdict } from "./rehireEligibility.js";
import { loadRehireFacts, type SqlExecutor } from "./rehireFacts.js";

export interface RejoinRequestRow {
  id: string;
  employee_id: string;
  proposed_joining_date: string;
  absconding_acknowledged: number;
}

export class RejoinBlockedError extends Error {
  constructor(public verdict: RehireVerdict, message: string) {
    super(message);
    this.name = "RejoinBlockedError";
  }
}

/**
 * Runs INSIDE the caller's transaction (caller owns begin/commit/rollback and the row lock on
 * the request). Everything is re-derived from the DB here — the eligibility snapshot stored at
 * raise time is for display only, because exit data, clearance and the disciplinary flag can
 * all change between raising and approving.
 */
export async function activateRejoin(
  conn: SqlExecutor,
  request: RejoinRequestRow,
  approverId: string,
  remarks: string,
): Promise<RehireVerdict> {
  const loaded = await loadRehireFacts(conn, request.employee_id, request.proposed_joining_date);
  if (!loaded) throw new RejoinBlockedError({ status: "blocked", reasons: [], requiresFreshOnboarding: false, requiresAbscondingAck: false }, "Employee not found");

  const verdict = evaluateRehire(loaded.facts);
  if (verdict.status === "blocked") {
    throw new RejoinBlockedError(verdict, verdict.reasons.find((r) => r.severity === "blocked")?.message ?? "Rejoin is blocked");
  }
  if (verdict.requiresAbscondingAck && Number(request.absconding_acknowledged) !== 1) {
    throw new RejoinBlockedError(verdict, "Absconding rejoin requires the branch head's acknowledgement");
  }

  // 1. Close the old exit. Payroll's resolver only reads accepted / notice_serving / exited, so
  //    'rejoined' takes this exit out of the end-of-employment calculation.
  if (loaded.exitRequestId) {
    await conn.execute(
      `UPDATE exit_request SET status = 'rejoined' WHERE id = ?`,
      [loaded.exitRequestId],
    );
    // 2. Open clearance on the old exit is superseded, not completed.
    await conn.execute(
      `UPDATE exit_clearance_checklist SET status = 'superseded'
        WHERE exit_request_id = ? AND LOWER(status) = 'pending'`,
      [loaded.exitRequestId],
    );
  }

  // 3. Stints. First rejoin ever: also record the original stint so history is complete.
  const [maxRows] = await conn.execute<RowDataPacket[]>(
    `SELECT COALESCE(MAX(stint_no), 0) AS n FROM employment_stint WHERE employee_id = ?`,
    [request.employee_id],
  );
  let nextNo = Number(maxRows[0]?.n ?? 0) + 1;
  if (nextNo === 1) {
    await conn.execute(
      `INSERT INTO employment_stint (employee_id, stint_no, start_date, end_date, end_exit_request_id)
       SELECT id, ?, date_of_joining, ?, ? FROM employees WHERE id = ?`,
      [1, loaded.previousEndDate, loaded.exitRequestId, request.employee_id],
    );
    nextNo = 2;
  } else {
    await conn.execute(
      `UPDATE employment_stint SET end_date = ?, end_exit_request_id = ?
        WHERE employee_id = ? AND end_date IS NULL`,
      [loaded.previousEndDate, loaded.exitRequestId, request.employee_id],
    );
  }
  await conn.execute(
    `INSERT INTO employment_stint (employee_id, stint_no, start_date, rejoin_request_id)
     VALUES (?, ?, ?, ?)`,
    [request.employee_id, nextNo, request.proposed_joining_date, request.id],
  );

  // 4. Reactivate. date_of_joining is deliberately NOT touched: it is the original joining date
  //    that tenure, probation and PF/ESIC first-joined logic read. The new stint carries the
  //    rejoin date.
  await conn.execute(
    `UPDATE employees SET employment_status = 'Active', active_status = 1, date_of_exit = NULL WHERE id = ?`,
    [request.employee_id],
  );

  // 5. Audit. Later plans' login re-provisioning, leave restore and payroll notice key on this row.
  await conn.execute(
    `INSERT INTO employee_reactivation_audit (request_id, action, actioned_by, remarks, metadata)
     VALUES (?, 'rejoin_activated', ?, ?, ?)`,
    [
      request.id,
      approverId,
      remarks,
      JSON.stringify({
        stintNo: nextNo,
        rejoinDate: request.proposed_joining_date,
        gapDays: loaded.facts.gapDays,
        ffAlreadyPaid: loaded.ffAlreadyPaid,
        reviewReasons: verdict.reasons.map((r) => r.code),
        previousExitRequestId: loaded.exitRequestId,
      }),
    ],
  );

  return verdict;
}
