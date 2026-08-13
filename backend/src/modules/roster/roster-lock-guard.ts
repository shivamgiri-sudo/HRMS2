import type { RowDataPacket } from "mysql2";

/**
 * Shared roster lifecycle-lock check — Part A.3 (2026-08-13), generalized
 * for round 2 so every roster-mutating write path can share one governance
 * function instead of each endpoint re-deriving its own copy (see the
 * three-roster-engine and A.3-coverage audits from the same round).
 *
 * The signal is attendance_daily_record.is_locked, set by
 * payroll-governance.service.ts's freezeAttendance() at the Attendance
 * Locked / Payroll Input Ready lifecycle step. Below that lock, callers are
 * unaffected. Above it, a normal destructive roster write for that
 * employee/date must be refused — a legitimate post-lock correction needs a
 * separate, explicitly-authorized correction/reopen workflow, not the
 * ordinary write path.
 */

type Executor = { execute<T extends RowDataPacket[] = RowDataPacket[]>(sql: string, params?: unknown[]): Promise<[T, unknown]> };

/** True when attendance for this exact employee/date is already locked for payroll. */
export async function isRosterDateLocked(
  dbConn: Executor,
  employeeId: string,
  rosterDate: string
): Promise<boolean> {
  const [rows] = await dbConn.execute<RowDataPacket[]>(
    `SELECT is_locked FROM attendance_daily_record WHERE employee_id = ? AND record_date = ? LIMIT 1`,
    [employeeId, rosterDate]
  );
  const row = rows[0];
  return !!row && Number(row.is_locked) === 1;
}

export type RosterLockCheckResult = { blocked: true; error: string } | { blocked: false };

/**
 * Same lookup as isRosterDateLocked, but resolved from a wfm_roster_assignment
 * id (joins to employee_id/roster_date itself) — the shape wfm.routes.ts's
 * manager-override endpoints already have on hand (an assignmentId, not a
 * bare employee/date pair). Byte-identical query and return shape to what
 * those 4 endpoints used before this extraction; wfm.routes.ts now delegates
 * to this function rather than keeping its own private copy.
 */
export async function checkAssignmentDateNotLocked(
  dbConn: Executor,
  assignmentId: string
): Promise<RosterLockCheckResult> {
  const [rows] = await dbConn.execute<RowDataPacket[]>(
    `SELECT adr.is_locked
       FROM wfm_roster_assignment wra
       LEFT JOIN attendance_daily_record adr
         ON adr.employee_id = wra.employee_id AND adr.record_date = wra.roster_date
      WHERE wra.id = ?
      LIMIT 1`,
    [assignmentId]
  );
  const row = rows[0];
  if (row && Number(row.is_locked) === 1) {
    return {
      blocked: true,
      error:
        "This roster date's attendance is already locked for payroll and can no longer be edited through the normal manager-review action. Use the payroll correction/reopen workflow instead.",
    };
  }
  return { blocked: false };
}

/** Same result shape, for a caller that already has employeeId + rosterDate
 *  directly (e.g. shift-swap, which resolves both sides' assignments up
 *  front) and doesn't need the assignment-id join. */
export async function checkEmployeeDateNotLocked(
  dbConn: Executor,
  employeeId: string,
  rosterDate: string,
  label = "This roster date"
): Promise<RosterLockCheckResult> {
  if (await isRosterDateLocked(dbConn, employeeId, rosterDate)) {
    return {
      blocked: true,
      error: `${label}'s attendance is already locked for payroll and can no longer be edited through the normal roster-write path. Use the payroll correction/reopen workflow instead.`,
    };
  }
  return { blocked: false };
}
