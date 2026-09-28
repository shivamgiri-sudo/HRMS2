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
import { isShiftDueYet } from "./shift-due.util.js";
import { lobAnd, type LobFilter } from "../../shared/lobFilter.js";

const GRACE_MINUTES = 5;

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

function timeToMinutes(t: string): number {
  const parts = t.split(":").map(Number);
  return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
}

export async function getProcessTeamRosterView(
  processId: string,
  date: string,
  lob: LobFilter = { kind: "none" },
): Promise<ProcessTeamRosterView> {
  const lobSql = lobAnd(lob);

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
         AND e.employment_status = 'Active'${lobSql.sql}
       ORDER BY e.full_name`,
      [date, date, date, date, processId, ...lobSql.params],
    ),
  ]);

  const processName = processResult[0][0]?.process_name
    ? String(processResult[0][0].process_name)
    : null;
  const rows = employeeResult[0];

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
    const shiftStart = r.template_start || r.shift_start_time;
    const shiftEnd = r.template_end || r.shift_end_time;
    const shiftTime =
      shiftStart && shiftEnd
        ? `${String(shiftStart).slice(0, 5)}-${String(shiftEnd).slice(0, 5)}`
        : null;

    // first_in is now "HH:MM:SS" (TIME_FORMAT ensures this); timeToMinutes is safe.
    const firstIn: string | null = r.first_in ? String(r.first_in) : null;

    let status: ProcessTeamRosterStatus;
    let minutesLate: number | null = null;

    if (type === "WEEK_OFF" || type === "HOLIDAY") {
      status = "WEEK_OFF_HOLIDAY";
      counts.weekOffHoliday++;
    } else if (type === "LEAVE") {
      status = "ON_LEAVE";
      counts.onLeave++;
    } else if (firstIn) {
      const loginMin = timeToMinutes(firstIn);
      const shiftStartMin = shiftStart
        ? timeToMinutes(String(shiftStart).slice(0, 8))
        : 0;
      if (shiftStart && loginMin > shiftStartMin + GRACE_MINUTES) {
        status = "LATE";
        minutesLate = loginMin - shiftStartMin;
        counts.late++;
      } else {
        status = "ON_TIME";
        counts.onTime++;
      }
    } else if (
      !isShiftDueYet(
        shiftStart ? String(shiftStart) : null,
        date,
        GRACE_MINUTES,
      )
    ) {
      status = "UPCOMING";
      counts.upcoming++;
    } else {
      status = "ABSENT";
      counts.absent++;
    }

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
        : type === "LEAVE"
          ? "Leave"
          : null,
    };
  });

  return { processId, processName, date, members, counts };
}
