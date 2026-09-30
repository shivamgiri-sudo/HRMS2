/**
 * Process Team Roster — member drill-down detail (Drill-Down Mandate).
 * GET /api/roster-analytics/process-roster/member/:employeeId?date=YYYY-MM-DD
 *
 * Returns the full day record (roster assignment, attendance engine row, biometric punch
 * summary, approved leave), a 14-day timeline, a month summary with correct denominators
 * (working days completed only: week-off/holiday/leave and not-yet-elapsed days are not
 * "planned"), roster change history and audit entries. Column names verified against
 * backend/sql (wfm_roster_assignment, attendance_daily_record, biometric_attendance_log,
 * leave_request, roster_change_log, audit_action_log).
 */
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { todayLocalDateStr } from "./shift-due.util.js";
import { classifyMember, type RosterStatus } from "./process-team-roster.util.js";

const REAL_ROSTER =
  "NOT (ra.import_batch_id IS NULL AND ra.cycle_id IS NULL AND ra.assignment_type IS NULL AND ra.shift_template_id IS NULL)";

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Exclusive upper bound so a still-running (today) day is never counted as absent. */
export function completedDaysBound(date: string, today: string): string {
  if (date < today) {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  return date;
}

export interface MonthCounts { planned: number; present: number; onTime: number; late: number; absent: number; leave: number; weekOff: number }

export function summarizeMonth(rows: Array<{ type: string | null; isWeekOff: number; attStatus: string | null; lateMark: number | null }>): MonthCounts & { adherencePct: number | null } {
  const c: MonthCounts = { planned: 0, present: 0, onTime: 0, late: 0, absent: 0, leave: 0, weekOff: 0 };
  for (const r of rows) {
    const t = String(r.type ?? "").toUpperCase();
    const a = String(r.attStatus ?? "");
    if (r.isWeekOff || t === "WEEK_OFF" || t === "HOLIDAY" || a === "week_off" || a === "holiday") { c.weekOff++; continue; }
    if (t === "LEAVE" || a === "leave_approved") { c.leave++; continue; }
    c.planned++;
    if (a === "present" || a === "half_day") {
      c.present++;
      if ((r.lateMark ?? 0) > 0) c.late++; else c.onTime++;
    } else c.absent++;
  }
  return { ...c, adherencePct: c.planned > 0 ? Math.round((c.present / c.planned) * 1000) / 10 : null };
}

const s = (v: unknown) => (v == null ? null : String(v));

export async function getProcessRosterMemberDetail(employeeId: string, date: string) {
  const today = todayLocalDateStr();
  const upto = completedDaysBound(date, today);
  const monthStart = `${date.slice(0, 7)}-01`;
  const timelineFrom = (() => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 13); return d.toISOString().slice(0, 10); })();

  const [empQ, dayQ, attQ, bioQ, leaveQ, tlQ, monthQ, chgQ, auditQ] = await Promise.all([
    db.execute<RowDataPacket[]>(
      `SELECT e.id, e.employee_code, e.full_name, e.employment_status, e.employment_type, e.date_of_joining,
              e.reporting_manager_id, COALESCE(dm.designation_name,'') AS designation,
              p.process_name, lm.lob_name, b.branch_name, m.full_name AS manager_name,
              DATEDIFF(CURDATE(), e.date_of_joining) AS aon_days
       FROM employees e
       LEFT JOIN designation_master dm ON dm.id = e.designation_id
       LEFT JOIN process_master p ON p.id = e.process_id
       LEFT JOIN lob_master lm ON lm.id = e.lob_id
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN employees m ON m.id = e.reporting_manager_id
       WHERE e.id = ?`, [employeeId]),
    db.execute<RowDataPacket[]>(
      `SELECT ra.id, ra.assignment_type, ra.roster_status, ra.final_roster_status, ra.publish_status, ra.lifecycle_state,
              ra.shift_start_time, ra.shift_end_time, ra.scheduled_minutes, ra.employee_ack_status, ra.employee_ack_at,
              ra.employee_rejection_reason, ra.manager_action_status, ra.manager_action_at, ra.manager_action_reason,
              ra.system_decision_reason, ra.decision_source, ra.created_at, ra.updated_at,
              st.shift_name, st.start_time AS template_start, st.end_time AS template_end, st.grace_minutes
       FROM wfm_roster_assignment ra
       LEFT JOIN wfm_shift_template st ON st.id = ra.shift_template_id
       WHERE ra.employee_id = ? AND ra.roster_date = ? LIMIT 1`, [employeeId, date]),
    db.execute<RowDataPacket[]>(
      `SELECT attendance_status, attendance_source, late_mark, late_by_minutes, raw_minutes, is_locked,
              override_reason, DATE_FORMAT(clock_in_time,'%Y-%m-%d %H:%i:%s') AS clock_in,
              DATE_FORMAT(clock_out_time,'%Y-%m-%d %H:%i:%s') AS clock_out, processed_at
       FROM attendance_daily_record WHERE employee_id = ? AND record_date = ? LIMIT 1`, [employeeId, date]),
    db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(first_punch_in,'%Y-%m-%d %H:%i:%s') AS first_in,
              DATE_FORMAT(last_punch_out,'%Y-%m-%d %H:%i:%s') AS last_out, total_punches, raw_minutes
       FROM biometric_attendance_log WHERE employee_id = ? AND punch_date = ? LIMIT 1`, [employeeId, date]),
    db.execute<RowDataPacket[]>(
      `SELECT lr.id, lt.leave_name, lr.from_date, lr.to_date, lr.total_days, lr.status, lr.reason, lr.applied_at,
              lr.approved_at, appr.full_name AS approved_by_name
       FROM leave_request lr
       LEFT JOIN leave_type_master lt ON lt.id = lr.leave_type_id
       LEFT JOIN employees appr ON appr.id = lr.approved_by
       WHERE lr.employee_id = ? AND ? BETWEEN lr.from_date AND lr.to_date
       ORDER BY lr.applied_at DESC LIMIT 10`, [employeeId, date]),
    db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(ra.roster_date,'%Y-%m-%d') AS d, ra.assignment_type, ra.is_week_off,
              adr.attendance_status, adr.late_mark, adr.late_by_minutes,
              DATE_FORMAT(COALESCE(adr.clock_in_time, bal.first_punch_in),'%H:%i') AS first_in
       FROM wfm_roster_assignment ra
       LEFT JOIN attendance_daily_record adr ON adr.employee_id = ra.employee_id AND adr.record_date = ra.roster_date
       LEFT JOIN biometric_attendance_log bal ON bal.employee_id = ra.employee_id AND bal.punch_date = ra.roster_date
       WHERE ra.employee_id = ? AND ra.roster_date BETWEEN ? AND ? AND ${REAL_ROSTER}
       ORDER BY ra.roster_date`, [employeeId, timelineFrom, date]),
    db.execute<RowDataPacket[]>(
      `SELECT ra.assignment_type, ra.is_week_off, adr.attendance_status, adr.late_mark
       FROM wfm_roster_assignment ra
       LEFT JOIN attendance_daily_record adr ON adr.employee_id = ra.employee_id AND adr.record_date = ra.roster_date
       WHERE ra.employee_id = ? AND ra.roster_date >= ? AND ra.roster_date < ? AND ${REAL_ROSTER}`,
      [employeeId, monthStart, upto]),
    db.execute<RowDataPacket[]>(
      `SELECT c.change_type, c.reason, c.amendment_reason, c.old_assignment_type, c.new_assignment_type,
              c.change_date, c.created_at, ch.full_name AS changed_by_name
       FROM roster_change_log c
       LEFT JOIN employees ch ON ch.id = c.changed_by
       WHERE c.employee_id = ? AND c.change_date BETWEEN ? AND ?
       ORDER BY c.created_at DESC LIMIT 10`, [employeeId, timelineFrom, date]).catch(() => [[]] as unknown as [RowDataPacket[]]),
    db.execute<RowDataPacket[]>(
      `SELECT a.action_type, a.module_key, a.created_at, ac.full_name AS actor_name
       FROM audit_action_log a
       LEFT JOIN employees ac ON ac.user_id = a.actor_user_id
       WHERE a.entity_id = ? ORDER BY a.created_at DESC LIMIT 10`, [employeeId]).catch(() => [[]] as unknown as [RowDataPacket[]]),
  ]);

  const emp = empQ[0][0];
  if (!emp) return null;
  const ra = dayQ[0][0];
  const att = attQ[0][0];
  const bio = bioQ[0][0];
  const leaves = leaveQ[0];

  const hasOwn = ra?.shift_start_time && ra?.shift_end_time;
  const shiftStart = ra ? (hasOwn ? ra.shift_start_time : ra.template_start || ra.shift_start_time) : null;
  const shiftEnd = ra ? (hasOwn ? ra.shift_end_time : ra.template_end || ra.shift_end_time) : null;
  const firstInFull = s(att?.clock_in ?? bio?.first_in);
  const approvedLeave = leaves.find((l) => ["approved", "branch_head_approved"].includes(String(l.status)));

  let status: RosterStatus | null = null;
  let minutesLate: number | null = null;
  if (ra) {
    const r = classifyMember({
      assignmentType: s(ra.assignment_type), shiftStart: s(shiftStart),
      firstIn: firstInFull ? firstInFull.slice(11, 19) : null,
      attStatus: s(att?.attendance_status), attLateMark: att?.late_mark ?? null, attLateByMinutes: att?.late_by_minutes ?? null,
      hasApprovedLeave: !!approvedLeave, graceMinutes: ra.grace_minutes ?? null,
    }, date);
    status = r.status; minutesLate = r.minutesLate;
  }

  const month = summarizeMonth(monthQ[0].map((r) => ({
    type: s(r.assignment_type), isWeekOff: Number(r.is_week_off ?? 0), attStatus: s(r.attendance_status), lateMark: r.late_mark ?? null,
  })));

  return {
    date,
    status,
    minutesLate,
    employee: {
      id: String(emp.id), employeeCode: s(emp.employee_code), fullName: s(emp.full_name), designation: s(emp.designation),
      processName: s(emp.process_name), lobName: s(emp.lob_name), branchName: s(emp.branch_name), managerName: s(emp.manager_name),
      employmentStatus: s(emp.employment_status), employmentType: s(emp.employment_type),
      dateOfJoining: s(emp.date_of_joining), aonDays: emp.aon_days == null ? null : Number(emp.aon_days),
    },
    rosterAssignment: ra ? {
      id: String(ra.id), assignmentType: s(ra.assignment_type), rosterStatus: s(ra.final_roster_status ?? ra.roster_status),
      publishStatus: s(ra.publish_status), lifecycleState: s(ra.lifecycle_state), shiftName: s(ra.shift_name),
      shiftStart: s(shiftStart), shiftEnd: s(shiftEnd), scheduledMinutes: ra.scheduled_minutes ?? null,
      graceMinutes: ra.grace_minutes ?? null, decisionSource: s(ra.decision_source), systemDecisionReason: s(ra.system_decision_reason),
      ackStatus: s(ra.employee_ack_status), ackAt: s(ra.employee_ack_at), ackRejectionReason: s(ra.employee_rejection_reason),
      managerActionStatus: s(ra.manager_action_status), managerActionAt: s(ra.manager_action_at), managerActionReason: s(ra.manager_action_reason),
      createdAt: s(ra.created_at), updatedAt: s(ra.updated_at),
    } : null,
    attendance: att ? {
      status: s(att.attendance_status), source: s(att.attendance_source), lateMark: Number(att.late_mark ?? 0), lateByMinutes: Number(att.late_by_minutes ?? 0),
      rawMinutes: Number(att.raw_minutes ?? 0), locked: !!att.is_locked, overrideReason: s(att.override_reason),
      clockIn: s(att.clock_in), clockOut: s(att.clock_out), processedAt: s(att.processed_at),
    } : null,
    biometric: bio ? { firstIn: s(bio.first_in), lastOut: s(bio.last_out), totalPunches: bio.total_punches ?? null, rawMinutes: bio.raw_minutes ?? null } : null,
    leaves: leaves.map((l) => ({
      id: String(l.id), leaveType: s(l.leave_name), fromDate: s(l.from_date), toDate: s(l.to_date), totalDays: l.total_days == null ? null : Number(l.total_days),
      status: s(l.status), reason: s(l.reason), appliedAt: s(l.applied_at), approvedAt: s(l.approved_at), approvedBy: s(l.approved_by_name),
    })),
    timeline: tlQ[0].map((r) => ({
      date: String(r.d), type: s(r.assignment_type), isWeekOff: Number(r.is_week_off ?? 0) === 1, attStatus: s(r.attendance_status),
      lateMark: Number(r.late_mark ?? 0), lateByMinutes: Number(r.late_by_minutes ?? 0), firstIn: s(r.first_in),
    })),
    month: { month: date.slice(0, 7), throughDate: upto === date ? date : undefined, ...month },
    rosterChanges: chgQ[0].map((r) => ({
      changeType: s(r.change_type), reason: s(r.amendment_reason ?? r.reason), from: s(r.old_assignment_type), to: s(r.new_assignment_type),
      changeDate: s(r.change_date), at: s(r.created_at), by: s(r.changed_by_name),
    })),
    audit: auditQ[0].map((r) => ({ action: s(r.action_type), module: s(r.module_key), at: s(r.created_at), actor: s(r.actor_name) })),
  };
}
