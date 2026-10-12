/**
 * Attendance check for an F&F.
 *
 * The final month is paid on paid days, so a settlement is only as right as the attendance behind
 * it. This reads the same attendance_daily_record rows payroll reads (same IST day conversion) for
 * the span first-of-month .. last working day, and reports what is missing: days with no record at
 * all, loss-of-pay days, and records that sit AFTER the last working day (which payroll excludes).
 *
 * `unmarked_days` is the number that blocks approval. A week off or holiday has its own status row,
 * so a genuinely unmarked day means attendance was never closed for that date.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

export interface FfAttendanceCheck {
  month: string | null;
  from: string | null;
  to: string | null;
  calendar_days: number;
  recorded_days: number;
  present_days: number;
  leave_days: number;
  week_off_holiday_days: number;
  lwp_days: number;
  unmarked_days: number;
  unmarked_dates: string[];
  post_exit_records: number;
  ok: boolean;
  note: string;
}

const DAY = 86_400_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export async function ffAttendanceCheck(
  employeeId: string,
  lastWorkingDay: string | null,
): Promise<FfAttendanceCheck> {
  const empty = (note: string): FfAttendanceCheck => ({
    month: null, from: null, to: null, calendar_days: 0, recorded_days: 0, present_days: 0,
    leave_days: 0, week_off_holiday_days: 0, lwp_days: 0, unmarked_days: 0, unmarked_dates: [],
    post_exit_records: 0, ok: false, note,
  });
  if (!lastWorkingDay) return empty("No last working day recorded, so attendance cannot be checked.");
  const to = String(lastWorkingDay).slice(0, 10);
  const from = `${to.slice(0, 7)}-01`;
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT DATE(CONVERT_TZ(record_date, '+00:00', '+05:30')) AS d, attendance_status, lwp_value
         FROM attendance_daily_record
        WHERE employee_id = ?
          AND DATE(CONVERT_TZ(record_date, '+00:00', '+05:30')) BETWEEN ? AND LAST_DAY(?)`,
      [employeeId, from, to],
    );
    const byDay = new Map<string, { status: string; lwp: number }>();
    let post = 0;
    for (const r of rows) {
      const d = ymd(new Date(r.d as string | Date));
      if (d > to) { post++; continue; }
      byDay.set(d, { status: String(r.attendance_status ?? ""), lwp: Number(r.lwp_value ?? 0) });
    }
    // Calendar days from the 1st (or the day they started, if that is later) to the LWD.
    const [st] = await db.execute<RowDataPacket[]>(
      `SELECT COALESCE(salary_start_date, date_of_joining) AS s FROM employees WHERE id = ? LIMIT 1`,
      [employeeId],
    );
    const start = st[0]?.s ? ymd(new Date(st[0].s as string | Date)) : from;
    const first = start > from ? start : from;
    const unmarked: string[] = [];
    let calendar = 0;
    for (let t = Date.parse(first); t <= Date.parse(to); t += DAY) {
      calendar++;
      const d = ymd(new Date(t));
      if (!byDay.has(d)) unmarked.push(d);
    }
    let present = 0, leave = 0, off = 0, lwp = 0;
    for (const v of byDay.values()) {
      if (v.status === "present" || v.status === "late") present++;
      else if (v.status === "leave_approved") leave++;
      else if (v.status === "week_off" || v.status === "holiday") off++;
      lwp += v.lwp;
    }
    const ok = unmarked.length === 0;
    return {
      month: to.slice(0, 7), from: first, to, calendar_days: calendar, recorded_days: byDay.size,
      present_days: present, leave_days: leave, week_off_holiday_days: off, lwp_days: lwp,
      unmarked_days: unmarked.length, unmarked_dates: unmarked.slice(0, 31), post_exit_records: post, ok,
      note: ok
        ? `Attendance complete for ${first}..${to}: ${present} present, ${leave} leave, ${off} off/holiday, ${lwp} LWP.`
        : `${unmarked.length} day(s) in ${first}..${to} have no attendance record (${unmarked.slice(0, 5).join(", ")}${unmarked.length > 5 ? "…" : ""}). Close or back-fill attendance before approving, or the final month's paid days are wrong.`,
    };
  } catch (err) {
    return empty(`Attendance could not be checked: ${(err as Error).message}`);
  }
}
