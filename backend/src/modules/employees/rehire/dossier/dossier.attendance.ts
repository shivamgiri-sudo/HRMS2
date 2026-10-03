import type { RowDataPacket } from "mysql2";
import { num, round1, type DossierWindow, type SqlExecutor } from "./dossierTypes.js";

export interface AttendanceMonth {
  month: string;
  workingDays: number;
  present: number;
  halfDay: number;
  absent: number;
  leave: number;
  missingPunch: number;
  lateMarks: number;
  lopDays: number;
  lateMinutes: number;
}

export interface AttendanceTotals {
  workingDays: number;
  present: number;
  halfDay: number;
  absent: number;
  leave: number;
  missingPunch: number;
  lateMarks: number;
  lopDays: number;
  lateMinutes: number;
}

export interface AttendanceSection {
  months: AttendanceMonth[];
  totals: AttendanceTotals;
  /** (present + 0.5 x half_day + approved leave) / working days x 100, capped at 100. */
  attendancePct: number | null;
  regularizations: { total: number; approved: number; rejected: number; pending: number };
  late: {
    totalLateMarks: number;
    avgLateMarksPerMonth: number | null;
    avgLateMinutes: number | null;
    worstMonth: { month: string; lateMarks: number } | null;
  };
}

// Status semantics copied from payroll/payrollCalculate.service.ts and analytics/employee-360.service.ts:
// 'late' is NOT an attendance_status — a late day is late_mark = 1 on a present row. Working days exclude
// week_off and holiday. The percentage deliberately divides by WORKING days (Employee 360 divides by every
// recorded day, which dilutes the figure with week-offs).
const ATTENDANCE_SQL = `
  SELECT DATE_FORMAT(record_date, '%Y-%m') AS month,
         COUNT(CASE WHEN attendance_status NOT IN ('week_off','holiday') THEN 1 END) AS working_days,
         SUM(attendance_status = 'present') AS present_days,
         SUM(attendance_status = 'half_day') AS half_days,
         SUM(attendance_status = 'absent') AS absent_days,
         SUM(attendance_status = 'leave_approved') AS leave_days,
         SUM(attendance_status = 'missing_punch') AS missing_punch,
         SUM(late_mark = 1) AS late_marks,
         COALESCE(SUM(lwp_value), 0) AS lop_days,
         COALESCE(SUM(CASE WHEN late_mark = 1 THEN late_by_minutes END), 0) AS late_minutes
    FROM attendance_daily_record
   WHERE employee_id = ? AND record_date BETWEEN ? AND ?
   GROUP BY DATE_FORMAT(record_date, '%Y-%m')
   ORDER BY month`;

const REGULARIZATION_SQL = `
  SELECT LOWER(status) AS status, COUNT(*) AS n
    FROM attendance_regularization
   WHERE employee_id = ? AND session_date BETWEEN ? AND ?
   GROUP BY LOWER(status)`;

export async function loadAttendanceSection(db: SqlExecutor, w: DossierWindow): Promise<AttendanceSection> {
  const [rows] = await db.execute<RowDataPacket[]>(ATTENDANCE_SQL, [w.employeeId, w.start, w.end]);
  const months: AttendanceMonth[] = rows.map((r) => ({
    month: String(r.month),
    workingDays: num(r.working_days),
    present: num(r.present_days),
    halfDay: num(r.half_days),
    absent: num(r.absent_days),
    leave: num(r.leave_days),
    missingPunch: num(r.missing_punch),
    lateMarks: num(r.late_marks),
    lopDays: num(r.lop_days),
    lateMinutes: num(r.late_minutes),
  }));

  const totals: AttendanceTotals = months.reduce(
    (t, m) => ({
      workingDays: t.workingDays + m.workingDays,
      present: t.present + m.present,
      halfDay: t.halfDay + m.halfDay,
      absent: t.absent + m.absent,
      leave: t.leave + m.leave,
      missingPunch: t.missingPunch + m.missingPunch,
      lateMarks: t.lateMarks + m.lateMarks,
      lopDays: t.lopDays + m.lopDays,
      lateMinutes: t.lateMinutes + m.lateMinutes,
    }),
    { workingDays: 0, present: 0, halfDay: 0, absent: 0, leave: 0, missingPunch: 0, lateMarks: 0, lopDays: 0, lateMinutes: 0 },
  );

  const attendancePct =
    totals.workingDays > 0
      ? Math.min(100, round1(((totals.present + 0.5 * totals.halfDay + totals.leave) / totals.workingDays) * 100))
      : null;

  const worst = months.reduce<AttendanceMonth | null>(
    (best, m) => (m.lateMarks > 0 && (!best || m.lateMarks > best.lateMarks) ? m : best),
    null,
  );

  const [regRows] = await db.execute<RowDataPacket[]>(REGULARIZATION_SQL, [w.employeeId, w.start, w.end]);
  const regularizations = { total: 0, approved: 0, rejected: 0, pending: 0 };
  for (const r of regRows) {
    const n = num(r.n);
    regularizations.total += n;
    const s = String(r.status);
    if (s === "approved" || s === "branch_head_approved") regularizations.approved += n;
    else if (s === "rejected") regularizations.rejected += n;
    else if (s === "pending" || s === "manager_approved") regularizations.pending += n;
  }

  return {
    months,
    totals,
    attendancePct,
    regularizations,
    late: {
      totalLateMarks: totals.lateMarks,
      avgLateMarksPerMonth: months.length ? round1(totals.lateMarks / months.length) : null,
      avgLateMinutes: totals.lateMarks > 0 ? round1(totals.lateMinutes / totals.lateMarks) : null,
      worstMonth: worst ? { month: worst.month, lateMarks: worst.lateMarks } : null,
    },
  };
}
