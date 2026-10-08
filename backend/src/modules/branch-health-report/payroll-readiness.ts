/**
 * Branch Health Report — payroll readiness for the cycle month.
 *
 * Cycle month = the month whose pay is being prepared = the calendar month before the report date
 * (same rule as the payroll dashboard's cycleMonth). Deadlines come from payroll_calendar, which the
 * Payroll Head maintains; nothing here invents a deadline. Counting predicates are the ones the
 * Payroll Readiness page uses, so this email and that page agree.
 *
 * A fact that cannot be read comes back as null and produces NO escalation. A wrong red line is
 * worse than a missing one, so every query failure degrades to "not known".
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

export interface PayrollCalendarDates {
  attendanceCutoff: string | null;
  incentiveDeadline: string | null;
  branchReadinessDeadline: string | null;
  payrollRunDate: string | null;
}

export type IncentiveState = "none" | "pending_approval" | "approved";

export interface PayrollReadiness {
  cycleMonth: string;
  /** null = no payroll_calendar row for the cycle month, so no deadline-based finding is possible. */
  calendar: PayrollCalendarDates | null;
  /** Pending regularizations for days inside the cycle month (pending / escalated). null = unreadable. */
  pendingRegularization: number | null;
  /** Pending leave whose span touches the cycle month. null = unreadable. */
  pendingLeave: number | null;
  /** This branch uploaded incentives for either of the two cycles before this one. */
  incentivesExpected: boolean | null;
  incentiveState: IncentiveState | null;
  /** HRMS-raised increment requests still awaiting approval (submitted / hr_validated). */
  pendingIncrements: number | null;
  oldestIncrementDays: number | null;
}

export const emptyPayrollReadiness = (cycleMonth: string): PayrollReadiness => ({
  cycleMonth,
  calendar: null,
  pendingRegularization: null,
  pendingLeave: null,
  incentivesExpected: null,
  incentiveState: null,
  pendingIncrements: null,
  oldestIncrementDays: null,
});

/** Month before the report date, YYYY-MM. */
export function cycleMonthOf(reportDate: string): string {
  const y = Number(reportDate.slice(0, 4));
  const m = Number(reportDate.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

const shiftMonth = (ym: string, by: number): string => {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + by, 1));
  return d.toISOString().slice(0, 7);
};

const lastDay = (ym: string): string =>
  new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).toISOString().slice(0, 10);

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    console.warn(`[branch-health] payroll readiness query skipped: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/** incentive_upload_batch carries the month as salary_month (bulk upload) or pay_month (legacy); read what exists. */
let batchMonthSql: Promise<string | null> | null = null;
function incentiveMonthColumn(): Promise<string | null> {
  batchMonthSql ??= (async () => {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'incentive_upload_batch'
          AND COLUMN_NAME IN ('salary_month','pay_month','branch_id')`,
    );
    const cols = new Set((rows as RowDataPacket[]).map((r) => String(r.c)));
    if (!cols.has("branch_id")) return null;
    const m = ["salary_month", "pay_month"].filter((c) => cols.has(c));
    return m.length ? `COALESCE(${m.map((c) => `NULLIF(${c}, '')`).join(", ")})` : null;
  })().catch(() => null);
  return batchMonthSql;
}

export async function fetchPayrollReadiness(
  branchId: string,
  reportDate: string,
): Promise<PayrollReadiness> {
  const cycle = cycleMonthOf(reportDate);
  const out = emptyPayrollReadiness(cycle);
  const start = `${cycle}-01`;
  const end = lastDay(cycle);

  const [cal, regs, leave, inc, incr] = await Promise.all([
    safe(async () => {
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT DATE_FORMAT(attendance_cutoff_date,'%Y-%m-%d') AS cutoff,
                DATE_FORMAT(incentive_upload_deadline,'%Y-%m-%d') AS incentive,
                DATE_FORMAT(branch_readiness_deadline,'%Y-%m-%d') AS readiness,
                DATE_FORMAT(payroll_run_date,'%Y-%m-%d') AS run
           FROM payroll_calendar WHERE calendar_month = ? LIMIT 1`,
        [cycle],
      );
      const r = rows[0] as any;
      return r
        ? ({
            attendanceCutoff: r.cutoff ?? null,
            incentiveDeadline: r.incentive ?? null,
            branchReadinessDeadline: r.readiness ?? null,
            payrollRunDate: r.run ?? null,
          } as PayrollCalendarDates)
        : null;
    }),
    safe(async () => {
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS cnt
           FROM attendance_regularization ar
           JOIN employees e ON e.id = ar.employee_id
          WHERE e.active_status = 1 AND e.branch_id = ?
            AND LOWER(ar.status) IN ('pending','escalated')
            AND ar.session_date BETWEEN ? AND ?`,
        [branchId, start, end],
      );
      return Number((rows[0] as any)?.cnt ?? 0);
    }),
    safe(async () => {
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS cnt
           FROM leave_request lr
           JOIN employees e ON e.id = lr.employee_id
          WHERE e.active_status = 1 AND e.branch_id = ?
            AND LOWER(lr.status) = 'pending'
            AND COALESCE(lr.start_date, lr.from_date) <= ?
            AND COALESCE(lr.end_date, lr.to_date) >= ?`,
        [branchId, end, start],
      );
      return Number((rows[0] as any)?.cnt ?? 0);
    }),
    safe(async () => {
      const col = await incentiveMonthColumn();
      if (!col) return null;
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT ${col} AS m, LOWER(status) AS s
           FROM incentive_upload_batch
          WHERE branch_id = ? AND ${col} IN (?, ?, ?)`,
        [branchId, cycle, shiftMonth(cycle, -1), shiftMonth(cycle, -2)],
      );
      const usable = (rows as RowDataPacket[]).filter((r) => r.s !== "rejected" && r.s !== "draft");
      const forCycle = usable.filter((r) => String(r.m).slice(0, 7) === cycle).map((r) => String(r.s));
      const state: IncentiveState = forCycle.some((s) => s === "approved" || s === "applied")
        ? "approved"
        : forCycle.length
          ? "pending_approval"
          : "none";
      const expected = usable.some((r) => String(r.m).slice(0, 7) !== cycle);
      return { state, expected };
    }),
    safe(async () => {
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS cnt, COALESCE(MAX(DATEDIFF(?, DATE(s.created_at))), 0) AS oldest
           FROM salary_increment_request s
           JOIN employees e ON e.id = s.employee_id
          WHERE e.branch_id = ? AND s.source = 'hrms'
            AND s.status IN ('submitted','hr_validated')`,
        [reportDate, branchId],
      );
      return { n: Number((rows[0] as any)?.cnt ?? 0), oldest: Number((rows[0] as any)?.oldest ?? 0) };
    }),
  ]);

  out.calendar = cal;
  out.pendingRegularization = regs;
  out.pendingLeave = leave;
  if (inc) {
    out.incentiveState = inc.state;
    out.incentivesExpected = inc.expected;
  }
  if (incr) {
    out.pendingIncrements = incr.n;
    out.oldestIncrementDays = incr.oldest;
  }
  return out;
}
