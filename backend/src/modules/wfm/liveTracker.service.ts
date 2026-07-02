import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

export interface LiveSession {
  employee_id: string;
  employee_code: string;
  employee_name: string;
  process_name: string | null;
  branch_name: string | null;
  shift_start_time: string | null;
  shift_end_time: string | null;
  required_minutes: number;
  login_time: string | null;
  logout_time: string | null;
  total_login_minutes: number;
  current_status: string;
  punch_source: string | null;
  session_date: string;
  adherence_pct: number;
}

export interface LiveTrackerSummary {
  total: number;
  logged_in: number;
  logged_out: number;
  absent: number;
  overall_adherence_pct: number;
}

export interface LiveTrackerResult {
  date: string;
  sessions: LiveSession[];
  summary: LiveTrackerSummary;
}

export interface LiveTrackerFilters {
  date?: string;
  processName?: string;
  branchName?: string;
}

export async function getLiveTracker(filters: LiveTrackerFilters): Promise<LiveTrackerResult> {
  const date = filters.date ?? new Date().toISOString().slice(0, 10);

  const conds: string[] = ["ra.roster_date = ?"];
  const params: unknown[] = [date];

  if (filters.processName) { conds.push("ra.process_name = ?"); params.push(filters.processName); }
  if (filters.branchName)  { conds.push("ra.branch_name = ?");  params.push(filters.branchName); }

  const where = conds.join(" AND ");

  // Left-join roster assignments with attendance sessions so absent employees show up
  const sql = `
    SELECT
      e.id               AS employee_id,
      e.employee_code,
      CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS employee_name,
      ra.process_name,
      ra.branch_name,
      COALESCE(ra.shift_start_time, sm.start_time) AS shift_start_time,
      COALESCE(ra.shift_end_time,   sm.end_time)   AS shift_end_time,
      COALESCE(sm.required_minutes, 0)             AS required_minutes,
      s.login_time,
      s.logout_time,
      COALESCE(s.total_login_minutes, 0)           AS total_login_minutes,
      COALESCE(s.current_status, 'Absent')         AS current_status,
      s.punch_source,
      ra.roster_date                               AS session_date
    FROM wfm_roster_assignment ra
    JOIN employees e ON e.id = ra.employee_id
    LEFT JOIN wfm_shift_master sm ON sm.id = ra.shift_id
    LEFT JOIN wfm_attendance_session s
           ON s.employee_id = ra.employee_id AND s.session_date = ra.roster_date
    WHERE ${where}
    ORDER BY ra.process_name, e.employee_code
  `;

  const [rows] = await db.execute<RowDataPacket[]>(sql, params);
  const raw = rows as Omit<LiveSession, "adherence_pct">[];

  const sessions: LiveSession[] = raw.map((r) => ({
    ...r,
    adherence_pct:
      r.required_minutes > 0
        ? Math.min(100, Math.round((r.total_login_minutes / r.required_minutes) * 100))
        : 0,
  }));

  const total      = sessions.length;
  const logged_in  = sessions.filter((s) => s.current_status === "Logged In").length;
  const logged_out = sessions.filter((s) => s.current_status === "Logged Out").length;
  const absent     = sessions.filter((s) => s.current_status === "Absent").length;

  const overall_adherence_pct =
    total > 0
      ? Math.round(sessions.reduce((sum, s) => sum + s.adherence_pct, 0) / total)
      : 0;

  return {
    date,
    sessions,
    summary: { total, logged_in, logged_out, absent, overall_adherence_pct },
  };
}
