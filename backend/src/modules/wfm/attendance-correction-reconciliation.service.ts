/**
 * Does the attendance record actually agree with what was approved?
 *
 * WHY THIS IS AN OUTCOME CHECK, NOT A CODE CHECK. Every writer of attendance_daily_record guards
 * its columns with `IF(is_locked = 0, VALUES(x), x)` — a statement that succeeds and changes
 * nothing on a locked day. No error, and no affected-row count that distinguishes "wrote" from
 * "silently declined". Two writers got that wrong at once and discarded 879 approved changes
 * (514.5 days of pay), each requester having been told their change was applied.
 *
 * attendanceLockGuard.ts stops the writers we know about. This exists because that is not the
 * same as stopping the class: it asks whether the record agrees with the decision, so a
 * divergence is caught whoever caused it — including writers that do not exist yet.
 *
 * Read-only. It reports; it never corrects. Repair is scripts/recover-silent-noop-attendance.cjs,
 * which is a deliberate act with an audit trail, not something a timer should do unattended.
 */

import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { HALF_DAY_ATTENDANCE_TRANSITION } from "../../shared/halfDayLeave.js";

/**
 * Legacy import codes still present in `new_status`, mapped to the canonical vocabulary.
 *
 * `requested_status` is canonical (present/absent/half_day) and is preferred. `new_status` mixes
 * both, so comparing it directly reports ~950 "P is not present" false positives — and a detector
 * that cries wolf gets muted, which lands us back where we started.
 */
const LEGACY_STATUS: Record<string, string> = { P: "present", A: "absent", HD: "half_day" };
/** Codes with no canonical equivalent — excluded rather than guessed at. */
const UNMAPPED = ["OD", "DH", "T"];
/** Days whose status the calendar decides, not a correction. */
const CALENDAR = ["holiday", "week_off", "week_off_worked"];

/** Statuses an approved half day moves off. Derived, so it cannot drift from the shared table. */
const HALF_DAY_SOURCES = Object.keys(HALF_DAY_ATTENDANCE_TRANSITION).filter(
  (k) => HALF_DAY_ATTENDANCE_TRANSITION[k] === "half_day",
);

export interface Divergence {
  employeeId: string;
  date: string;
  wanted: string;
  got: string;
  locked: boolean;
  source: "regularization" | "leave_whole_day" | "leave_half_day";
}

export interface ReconciliationResult {
  windowDays: number;
  /** Approved, diverged, on a locked day it does not own — the silent-no-op signature. */
  confirmed: Divergence[];
  /** The day changed AFTER approval (COSEC re-sync, APR import) — a different question. */
  regraded: Divergence[];
  /** Unlocked and untouched since approval — needs eyes, not necessarily a fault. */
  unexplained: Divergence[];
}

interface Row extends RowDataPacket {
  id: string;
  employee_id: string;
  d: string;
  wanted_raw: string | null;
  got: string;
  is_locked: number;
  regularization_id: string | null;
  reviewed_at: Date | null;
  updated_at: Date | null;
}

function quote(values: string[]): string {
  return values.map((v) => `'${v}'`).join(",");
}

export async function reconcileAttendanceCorrections(windowDays = 90): Promise<ReconciliationResult> {
  const since = `DATE_SUB(CURDATE(), INTERVAL ${Number(windowDays)} DAY)`;

  const [regs] = await db.query<Row[]>(`
    SELECT r.id, r.employee_id, DATE_FORMAT(r.session_date,'%Y-%m-%d') d,
           COALESCE(r.requested_status, r.new_status) wanted_raw,
           dr.attendance_status got, dr.is_locked, dr.regularization_id,
           r.reviewed_at, dr.updated_at
      FROM attendance_regularization r
      JOIN attendance_daily_record dr
        ON dr.employee_id = r.employee_id AND dr.record_date = r.session_date
     WHERE r.status = 'approved'
       AND r.session_date >= ${since}
       AND COALESCE(r.requested_status, r.new_status) IS NOT NULL
       AND COALESCE(r.requested_status, r.new_status) NOT IN (${quote(UNMAPPED)})
       AND dr.attendance_status NOT IN (${quote(CALENDAR)})`);

  const [wholeLeave] = await db.query<Row[]>(`
    SELECT l.id, l.employee_id, DATE_FORMAT(l.from_date,'%Y-%m-%d') d, 'leave' wanted_raw,
           dr.attendance_status got, dr.is_locked, dr.regularization_id,
           l.approved_at reviewed_at, dr.updated_at
      FROM leave_request l
      JOIN attendance_daily_record dr
        ON dr.employee_id = l.employee_id AND dr.record_date = l.from_date
     WHERE l.status = 'approved' AND l.from_date >= ${since} AND l.total_days = 1.00
       AND dr.attendance_status NOT IN ('leave_approved','absent',${quote(CALENDAR)})`);

  const [halfLeave] = await db.query<Row[]>(`
    SELECT l.id, l.employee_id, DATE_FORMAT(l.from_date,'%Y-%m-%d') d, 'half_day' wanted_raw,
           dr.attendance_status got, dr.is_locked, dr.regularization_id,
           l.approved_at reviewed_at, dr.updated_at
      FROM leave_request l
      JOIN attendance_daily_record dr
        ON dr.employee_id = l.employee_id AND dr.record_date = l.from_date
     WHERE l.status = 'approved' AND l.from_date >= ${since} AND l.total_days = 0.50
       AND dr.attendance_status IN (${quote(HALF_DAY_SOURCES)})`);

  const result: ReconciliationResult = { windowDays, confirmed: [], regraded: [], unexplained: [] };
  const tagged: Array<[Row[], Divergence["source"]]> = [
    [regs, "regularization"],
    [wholeLeave, "leave_whole_day"],
    [halfLeave, "leave_half_day"],
  ];

  for (const [rows, source] of tagged) {
    for (const r of rows) {
      const wanted = LEGACY_STATUS[r.wanted_raw ?? ""] ?? r.wanted_raw ?? "";
      // 'leave' is a marker, not a status: the query already selected only days that are not a
      // leave outcome, so those rows are divergent by construction.
      if (wanted !== "leave" && wanted === r.got) continue;

      const d: Divergence = {
        employeeId: r.employee_id,
        date: r.d,
        wanted,
        got: r.got,
        locked: Number(r.is_locked) === 1,
        source,
      };

      const ownsIt = r.regularization_id === r.id;
      const changedAfterApproval =
        !!r.reviewed_at && !!r.updated_at && new Date(r.updated_at) > new Date(r.reviewed_at);

      if (d.locked && !ownsIt) result.confirmed.push(d);
      else if (changedAfterApproval) result.regraded.push(d);
      else result.unexplained.push(d);
    }
  }

  return result;
}
