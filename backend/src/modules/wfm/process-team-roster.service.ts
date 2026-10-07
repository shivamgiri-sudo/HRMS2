/**
 * Process Team Roster — WFM Roster Console Phase C
 *
 * Answers "who's on my team right now" for a selected process on a given date, with a
 * color-coded status per employee: ON_TIME (green), LATE (amber), ABSENT (red),
 * ON_LEAVE (blue) — the 4 colors requested by the owner — plus 2 additional neutral
 * states that are real and would otherwise be silently misclassified into one of the
 * 4: WEEK_OFF_HOLIDAY (a day the employee was never scheduled to work) and UPCOMING
 * (today, shift scheduled but not yet due — reuses the isShiftDueYet guard shared with
 * roster-analytics.service.ts and roster-intelligence.service.ts, see shift-due.util.ts).
 *
 * Clock-in time: TIME_FORMAT(COALESCE(att.clock_in_time, bal.first_punch_in), '%H:%i:%s')
 * — biometric_attendance_log is the raw COSEC punch record and is tried first; the
 * attendance_daily_record.clock_in_time column stores the same value after the engine
 * processes it but is also a DATETIME. dateStrings:true makes both return as
 * "YYYY-MM-DD HH:MM:SS" strings; slicing to HH:MM requires TIME_FORMAT at SQL level.
 */
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { lobAnd, type LobFilter } from "../../shared/lobFilter.js";
import {
  classifyMember,
  dedupeByEmployee,
} from "./process-team-roster.util.js";

/** Excludes the synthetic 2026-06-11 roster cohort (see roster-analytics.routes.ts realRoster). */
const REAL_ROSTER =
  "NOT (ra.import_batch_id IS NULL AND ra.cycle_id IS NULL AND ra.assignment_type IS NULL AND ra.shift_template_id IS NULL)";

export type ProcessTeamRosterStatus =
  "ON_TIME" | "LATE" | "ABSENT" | "ON_LEAVE" | "WEEK_OFF_HOLIDAY" | "UPCOMING";

export interface ProcessTeamRosterMember {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  branchId: string | null;
  branchName: string | null;
  lobId: string | null;
  lobName: string | null;
  status: ProcessTeamRosterStatus;
  shiftName: string | null;
  shiftTime: string | null;
  clockInTime: string | null;
  clockOutTime: string | null;
  minutesLate: number | null;
  leaveType: string | null;
}

export interface ProcessTeamRosterView {
  processId: string;
  processName: string | null;
  date: string;
  members: ProcessTeamRosterMember[];
  counts: {
    onTime: number;
    late: number;
    absent: number;
    onLeave: number;
    weekOffHoliday: number;
    upcoming: number;
    total: number;
  };
}

export async function getProcessTeamRosterView(
  processId: string,
  date: string,
  lob: LobFilter = { kind: "none" },
  branchId?: string,
): Promise<ProcessTeamRosterView> {
  const lobSql = lobAnd(lob);
  const branchSql = branchId ? " AND e.branch_id = ?" : "";
  const branchParams = branchId ? [branchId] : [];

  // Run process-name lookup and the main employee query in parallel — previously sequential.
  const [processResult, employeeResult] = await Promise.all([
    db.execute<RowDataPacket[]>(
      `SELECT process_name FROM process_master WHERE id = ?`,
      [processId],
    ),
    db.execute<RowDataPacket[]>(
      `SELECT
         e.id AS employee_id,
         e.employee_code,
         e.full_name AS employee_name,
         e.branch_id,
         e.lob_id,
         b.branch_name,
         lm.lob_name,
         ra.assignment_type,
         ra.shift_start_time,
         ra.shift_end_time,
         st.shift_name,
         st.start_time AS template_start,
         st.end_time AS template_end,
         st.grace_minutes,
         att.attendance_status AS att_status,
         att.late_mark AS att_late_mark,
         att.late_by_minutes AS att_late_by,
         TIME_FORMAT(COALESCE(att.clock_in_time, bal.first_punch_in),  '%H:%i:%s') AS first_in,
         TIME_FORMAT(COALESCE(att.clock_out_time, bal.last_punch_out), '%H:%i:%s') AS last_out,
         lr.leave_type_id,
         lt.leave_name
       FROM employees e
       JOIN wfm_roster_assignment ra ON ra.employee_id = e.id AND ra.roster_date = ?
       LEFT JOIN wfm_shift_template st  ON st.id = ra.shift_template_id
       LEFT JOIN attendance_daily_record att
              ON att.employee_id = e.id AND att.record_date = ?
       LEFT JOIN biometric_attendance_log bal
              ON bal.employee_id = e.id AND bal.punch_date = ?
       LEFT JOIN branch_master b  ON b.id = e.branch_id
       LEFT JOIN lob_master    lm ON lm.id = e.lob_id
       LEFT JOIN leave_request lr ON lr.employee_id = e.id
         AND lr.status IN ('approved', 'branch_head_approved')
         AND ? BETWEEN lr.from_date AND lr.to_date
       LEFT JOIN leave_type_master lt ON lt.id = lr.leave_type_id
       WHERE e.process_id = ?
         AND e.active_status = 1
         AND e.employment_status = 'Active'
         AND ${REAL_ROSTER}${lobSql.sql}${branchSql}
       ORDER BY e.full_name`,
      [date, date, date, date, processId, ...lobSql.params, ...branchParams],
    ),
  ]);

  const processName = processResult[0][0]?.process_name
    ? String(processResult[0][0].process_name)
    : null;
  // leave_request can match >1 row per employee (overlapping approved leaves) — one member each.
  const rows = dedupeByEmployee(employeeResult[0] as RowDataPacket[]);

  const counts = {
    onTime: 0,
    late: 0,
    absent: 0,
    onLeave: 0,
    weekOffHoliday: 0,
    upcoming: 0,
    total: 0,
  };

  const members: ProcessTeamRosterMember[] = rows.map((r: RowDataPacket) => {
    const type = String(r.assignment_type ?? "").toUpperCase();
    // Assignment-level times (manual overrides) win over the template defaults.
    const hasOwn = r.shift_start_time && r.shift_end_time;
    const shiftStart = hasOwn
      ? r.shift_start_time
      : r.template_start || r.shift_start_time;
    const shiftEnd = hasOwn
      ? r.shift_end_time
      : r.template_end || r.shift_end_time;
    const shiftTime =
      shiftStart && shiftEnd
        ? `${String(shiftStart).slice(0, 5)}-${String(shiftEnd).slice(0, 5)}`
        : null;

    // first_in is now "HH:MM:SS" (TIME_FORMAT ensures this); timeToMinutes is safe.
    const firstIn: string | null = r.first_in ? String(r.first_in) : null;

    const { status, minutesLate } = classifyMember(
      {
        assignmentType: type,
        shiftStart: shiftStart ? String(shiftStart) : null,
        firstIn,
        attStatus: r.att_status ? String(r.att_status) : null,
        attLateMark: r.att_late_mark != null ? Number(r.att_late_mark) : null,
        attLateByMinutes: r.att_late_by != null ? Number(r.att_late_by) : null,
        hasApprovedLeave: r.leave_type_id != null,
        graceMinutes: r.grace_minutes != null ? Number(r.grace_minutes) : null,
      },
      date,
    );
    if (status === "WEEK_OFF_HOLIDAY") counts.weekOffHoliday++;
    else if (status === "ON_LEAVE") counts.onLeave++;
    else if (status === "LATE") counts.late++;
    else if (status === "ON_TIME") counts.onTime++;
    else if (status === "UPCOMING") counts.upcoming++;
    else counts.absent++;

    counts.total++;

    return {
      employeeId: String(r.employee_id),
      employeeCode: String(r.employee_code),
      employeeName: String(r.employee_name),
      branchId: r.branch_id ? String(r.branch_id) : null,
      branchName: r.branch_name ? String(r.branch_name) : null,
      lobId: r.lob_id ? String(r.lob_id) : null,
      lobName: r.lob_name ? String(r.lob_name) : null,
      status,
      shiftName: r.shift_name ? String(r.shift_name) : null,
      shiftTime,
      clockInTime: firstIn,
      clockOutTime: r.last_out ? String(r.last_out) : null,
      minutesLate,
      leaveType: r.leave_name
        ? String(r.leave_name)
        : status === "ON_LEAVE"
          ? "Leave"
          : null,
    };
  });

  return { processId, processName, date, members, counts };
}
