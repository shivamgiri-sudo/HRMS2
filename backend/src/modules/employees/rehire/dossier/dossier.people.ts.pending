import type { RowDataPacket } from "mysql2";
import { num, round1, type DossierWindow, type SqlExecutor } from "./dossierTypes.js";

export interface LeaveByType {
  leaveType: string;
  paid: boolean;
  requests: number;
  days: number;
  shortNotice: number;
  weekendAdjacent: number;
}

export interface LeaveSection {
  byType: LeaveByType[];
  totalRequests: number;
  totalDays: number;
  paidDays: number;
  unpaidDays: number;
  /** Heuristic: there is no planned/unplanned flag, so "short notice" = applied on or after the day before it started. */
  shortNoticeRequests: number;
  shortNoticePct: number | null;
  /** Starts on a Monday or ends on a Friday. */
  weekendAdjacentRequests: number;
  weekendAdjacentPct: number | null;
  balances: { leaveType: string; year: number; allocated: number; used: number; available: number }[];
}

const LEAVE_SQL = `
  SELECT COALESCE(lt.leave_name, lr.leave_type_code, 'Other') AS leave_type,
         COALESCE(lt.paid_leave, 1) AS paid,
         COUNT(*) AS requests,
         COALESCE(SUM(lr.total_days), 0) AS days,
         SUM(DATE(lr.applied_at) >= DATE_SUB(lr.from_date, INTERVAL 1 DAY)) AS short_notice,
         SUM(WEEKDAY(lr.from_date) = 0 OR WEEKDAY(lr.to_date) = 4) AS weekend_adjacent
    FROM leave_request lr
    LEFT JOIN leave_type_master lt ON lt.id = lr.leave_type_id
   WHERE lr.employee_id = ?
     AND lr.status IN ('approved', 'branch_head_approved')
     AND lr.from_date BETWEEN ? AND ?
   GROUP BY COALESCE(lt.leave_name, lr.leave_type_code, 'Other'), COALESCE(lt.paid_leave, 1)`;

// Same balance arithmetic as employees/employee.routes.ts: available = allocated + adjusted - used.
const BALANCE_SQL = `
  SELECT COALESCE(lt.leave_name, 'Other') AS leave_type, b.balance_year AS balance_year,
         b.allocated_days AS allocated_days, b.used_days AS used_days, b.adjusted_days AS adjusted_days
    FROM leave_balance_ledger b
    LEFT JOIN leave_type_master lt ON lt.id = b.leave_type_id
   WHERE b.employee_id = ?
   ORDER BY b.balance_year DESC
   LIMIT 40`;

export async function loadLeaveSection(db: SqlExecutor, w: DossierWindow): Promise<LeaveSection> {
  const [rows] = await db.execute<RowDataPacket[]>(LEAVE_SQL, [w.employeeId, w.start, w.end]);
  const byType: LeaveByType[] = rows.map((r) => ({
    leaveType: String(r.leave_type),
    paid: Number(r.paid) !== 0,
    requests: num(r.requests),
    days: num(r.days),
    shortNotice: num(r.short_notice),
    weekendAdjacent: num(r.weekend_adjacent),
  }));

  const totalRequests = byType.reduce((a, t) => a + t.requests, 0);
  const shortNoticeRequests = byType.reduce((a, t) => a + t.shortNotice, 0);
  const weekendAdjacentRequests = byType.reduce((a, t) => a + t.weekendAdjacent, 0);
  const pct = (n: number) => (totalRequests > 0 ? round1((n / totalRequests) * 100) : null);

  const [balRows] = await db.execute<RowDataPacket[]>(BALANCE_SQL, [w.employeeId]);
  const latest = new Map<string, LeaveSection["balances"][number]>();
  for (const r of balRows) {
    const type = String(r.leave_type);
    const year = num(r.balance_year);
    const existing = latest.get(type);
    if (existing && existing.year >= year) continue;
    const allocated = num(r.allocated_days);
    const used = num(r.used_days);
    latest.set(type, { leaveType: type, year, allocated, used, available: allocated + num(r.adjusted_days) - used });
  }

  return {
    byType,
    totalRequests,
    totalDays: byType.reduce((a, t) => a + t.days, 0),
    paidDays: byType.filter((t) => t.paid).reduce((a, t) => a + t.days, 0),
    unpaidDays: byType.filter((t) => !t.paid).reduce((a, t) => a + t.days, 0),
    shortNoticeRequests,
    shortNoticePct: pct(shortNoticeRequests),
    weekendAdjacentRequests,
    weekendAdjacentPct: pct(weekendAdjacentRequests),
    balances: [...latest.values()],
  };
}

export interface LearningSection {
  coursesTotal: number;
  coursesCompleted: number;
  avgCompletionPct: number | null;
  courses: { name: string; completionPct: number; status: string }[];
  certifications: { name: string; issued: string | null; expires: string | null; status: string }[];
}

// The snapshot tables already carry employees.id, so no lms_employee_mapping join is needed.
// Snapshot data covers a few hundred current employees only; an empty result is normal for a leaver.
const COURSE_SQL = `
  SELECT course_name, completion_pct, status
    FROM lms_learning_progress_snapshot
   WHERE employee_id = ?
   ORDER BY synced_at DESC
   LIMIT 50`;
const CERT_SQL = `
  SELECT certification_name,
         DATE_FORMAT(issued_date, '%Y-%m-%d') AS issued_date,
         DATE_FORMAT(expiry_date, '%Y-%m-%d') AS expiry_date,
         status
    FROM lms_certification_snapshot
   WHERE employee_id = ?
   ORDER BY issued_date DESC
   LIMIT 50`;

export async function loadLearningSection(db: SqlExecutor, w: DossierWindow): Promise<LearningSection> {
  const [courseRows] = await db.execute<RowDataPacket[]>(COURSE_SQL, [w.employeeId]);
  const [certRows] = await db.execute<RowDataPacket[]>(CERT_SQL, [w.employeeId]);
  const courses = courseRows.map((r) => ({
    name: String(r.course_name),
    completionPct: num(r.completion_pct),
    status: String(r.status),
  }));
  return {
    coursesTotal: courses.length,
    coursesCompleted: courses.filter((c) => c.status === "completed").length,
    avgCompletionPct: courses.length ? round1(courses.reduce((a, c) => a + c.completionPct, 0) / courses.length) : null,
    courses,
    certifications: certRows.map((r) => ({
      name: String(r.certification_name),
      issued: r.issued_date ?? null,
      expires: r.expiry_date ?? null,
      status: String(r.status),
    })),
  };
}
