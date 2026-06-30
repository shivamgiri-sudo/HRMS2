import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { inboxService } from "../inbox/inbox.service.js";

/**
 * For processes where weekoff_earning_required = true, an employee who both has
 * an approved leave and a rostered week-off on the same date should not have
 * both counted — the week-off is a company obligation that takes precedence.
 * This service restores the leave credit for any such overlap, idempotently.
 *
 * Called from two places:
 *   1. leave.service.ts reviewRequest() — immediately on leave approval
 *   2. payroll-window.routes.ts lock action — month-end safety net
 */

interface ReconciliationResult {
  restored: number;
  employees: number;
}

// ── Check if a process has weekoff_earning_required = true ───────────────────
async function isWeekoffEarningRequired(
  branchId: string | null,
  processId: string | null,
): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT config_value FROM payroll_config_flags
     WHERE config_key = 'weekoff_earning_required'
       AND (branch_id = ? OR branch_id IS NULL)
       AND (process_id = ? OR process_id IS NULL)
     ORDER BY (branch_id IS NOT NULL) DESC, (process_id IS NOT NULL) DESC
     LIMIT 1`,
    [branchId ?? null, processId ?? null],
  );
  const val = (rows[0] as any)?.config_value;
  // Default true unless explicitly set to "false"
  return val !== "false";
}

// ── Get rostered week-off dates for an employee within a date range ───────────
export async function getWeekOffDatesForEmployee(
  employeeId: string,
  fromDate: string,
  toDate: string,
): Promise<string[]> {
  // Check both the FCFS week_off_preference table and the attendance_daily_record
  // (attendance_daily_record is the ground truth once attendance is confirmed)
  const [attRows] = await db.execute<RowDataPacket[]>(
    `SELECT record_date FROM attendance_daily_record
     WHERE employee_id = ?
       AND record_date >= ? AND record_date <= ?
       AND attendance_status = 'week_off'`,
    [employeeId, fromDate, toDate],
  );

  const dates = new Set<string>(
    (attRows as RowDataPacket[]).map((r) => String(r.record_date).slice(0, 10)),
  );

  // Also check approved roster-preference week-offs (pre-confirmation)
  const [wopRows] = await db.execute<RowDataPacket[]>(
    `SELECT week_start_date, preferred_day_1 FROM week_off_preference
     WHERE employee_id = ?
       AND status IN ('accepted', 'applied', 'approved')
       AND week_start_date >= DATE_SUB(?, INTERVAL 6 DAY)
       AND week_start_date <= ?`,
    [employeeId, fromDate, toDate],
  );

  for (const row of wopRows as RowDataPacket[]) {
    const weekStart = new Date(String(row.week_start_date).slice(0, 10) + "T00:00:00");
    const dayOfWeek = Number(row.preferred_day_1); // 0=Sun … 6=Sat
    // Walk the week to find the actual calendar date for this day-of-week
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      if (d.getDay() === dayOfWeek) {
        const ds = d.toISOString().slice(0, 10);
        if (ds >= fromDate && ds <= toDate) dates.add(ds);
        break;
      }
    }
  }

  return Array.from(dates).sort();
}

// ── Restore one day's leave balance + log it ─────────────────────────────────
async function restoreLeaveDay(opts: {
  employeeId: string;
  leaveRequestId: string;
  leaveTypeId: string;
  overlapDate: string;
  daysToRestore: number;
  runMonth: string;
  restoredBy?: string;
  notes?: string;
  employeeUserId?: string | null;
  leaveTypeName?: string;
}): Promise<void> {
  const {
    employeeId, leaveRequestId, leaveTypeId, overlapDate,
    daysToRestore, runMonth, restoredBy = "system",
    notes, employeeUserId, leaveTypeName,
  } = opts;

  const year = new Date(overlapDate + "T00:00:00").getFullYear();

  // Restore used_days (never go below 0)
  await db.execute(
    `UPDATE leave_balance_ledger
     SET used_days = GREATEST(0, used_days - ?)
     WHERE employee_id = ? AND leave_type_id = ? AND balance_year = ?`,
    [daysToRestore, employeeId, leaveTypeId, year],
  );

  // Log the reconciliation (IGNORE on duplicate = idempotent)
  await db.execute(
    `INSERT IGNORE INTO leave_weekoff_reconciliation_log
       (id, employee_id, run_month, leave_request_id, leave_type_id,
        overlap_date, days_restored, restored_by, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(), employeeId, runMonth, leaveRequestId,
      leaveTypeId, overlapDate, daysToRestore, restoredBy, notes ?? null,
    ],
  );

  // Inbox notification to employee
  if (employeeUserId) {
    await inboxService.createItem({
      user_id: employeeUserId,
      type: "leave_credit_restored",
      title: "Leave credit restored — week-off overlap",
      description:
        `${daysToRestore} ${leaveTypeName ?? "leave"} day restored for ${overlapDate}. ` +
        `Your rostered week-off on that date means the leave credit was not consumed.`,
      entity_type: "leave_weekoff_reconciliation",
      entity_id: leaveRequestId,
      action_url: "/leave",
      priority: "normal",
    });
  }
}

// ── Called immediately on leave approval ─────────────────────────────────────
/**
 * Check whether any day in the approved leave overlaps with a rostered week-off
 * for a process where weekoff_earning_required = true.
 * Returns the number of days restored (0 if not applicable).
 */
export async function reconcileOnLeaveApproval(opts: {
  employeeId: string;
  leaveRequestId: string;
  leaveTypeId: string;
  leaveTypeName: string;
  fromDate: string;
  toDate: string;
  totalDays: number;
  employeeUserId?: string | null;
}): Promise<number> {
  const { employeeId, leaveRequestId, leaveTypeId, leaveTypeName,
    fromDate, toDate, totalDays, employeeUserId } = opts;

  // Get employee's branch/process to check config
  const [empRows] = await db.execute<RowDataPacket[]>(
    "SELECT branch_id, process_id FROM employees WHERE id = ? LIMIT 1",
    [employeeId],
  );
  const emp = (empRows[0] as any);
  if (!emp) return 0;

  const weekoffRequired = await isWeekoffEarningRequired(emp.branch_id, emp.process_id);
  if (!weekoffRequired) return 0;

  const overlapDates = await getWeekOffDatesForEmployee(employeeId, fromDate, toDate);
  if (overlapDates.length === 0) return 0;

  const runMonth = fromDate.slice(0, 7); // YYYY-MM
  let totalRestored = 0;

  for (const date of overlapDates) {
    // Each day = 1.0 (or 0.5 for half-day — use total_days / calendar_days ratio)
    const calDays = Math.max(
      1,
      Math.round(
        (new Date(toDate + "T00:00:00").getTime() - new Date(fromDate + "T00:00:00").getTime())
        / 86400000,
      ) + 1,
    );
    const daysPerCalDay = totalDays / calDays;
    const daysToRestore = Math.min(daysPerCalDay, 1);

    await restoreLeaveDay({
      employeeId,
      leaveRequestId,
      leaveTypeId,
      overlapDate: date,
      daysToRestore,
      runMonth,
      restoredBy: "approval_auto",
      notes: `Rostered week-off overlaps approved leave; process has weekoff_earning_required=true`,
      employeeUserId,
      leaveTypeName,
    });
    totalRestored += daysToRestore;
  }

  return totalRestored;
}

// ── Month-end safety net (called at payroll lock) ─────────────────────────────
/**
 * Scans all approved leaves in runMonth for employees in processes where
 * weekoff_earning_required = true, finds any overlap not already reconciled,
 * and restores those credits. Fully idempotent via UNIQUE KEY on the log table.
 */
export async function runLeaveWeekoffReconciliation(
  runMonth: string, // YYYY-MM
): Promise<ReconciliationResult> {
  const monthStart = runMonth + "-01";
  const [y, m] = runMonth.split("-").map(Number);
  const monthEnd = new Date(y, m, 0).toISOString().slice(0, 10);

  // All approved leaves that overlap this month, joined with employee config
  const [leaveRows] = await db.execute<RowDataPacket[]>(
    `SELECT lr.id            AS leave_request_id,
            lr.employee_id,
            lr.leave_type_id,
            lt.leave_name,
            lr.from_date,
            lr.to_date,
            lr.total_days,
            e.branch_id,
            e.process_id,
            au.id            AS user_id
       FROM leave_request lr
       JOIN employees e         ON e.id = lr.employee_id
       JOIN leave_type_master lt ON lt.id = lr.leave_type_id
       LEFT JOIN auth_user au   ON au.id = e.user_id
      WHERE lr.status = 'approved'
        AND lr.to_date   >= ?
        AND lr.from_date <= ?`,
    [monthStart, monthEnd],
  );

  let totalRestored = 0;
  const employeesAffected = new Set<string>();

  for (const row of leaveRows as RowDataPacket[]) {
    const weekoffRequired = await isWeekoffEarningRequired(
      row.branch_id ?? null,
      row.process_id ?? null,
    );
    if (!weekoffRequired) continue;

    // Clamp the leave period to this month
    const from = row.from_date > monthStart ? String(row.from_date).slice(0, 10) : monthStart;
    const to   = row.to_date   < monthEnd   ? String(row.to_date).slice(0, 10)   : monthEnd;

    const overlapDates = await getWeekOffDatesForEmployee(String(row.employee_id), from, to);
    if (overlapDates.length === 0) continue;

    const calDays = Math.max(
      1,
      Math.round(
        (new Date(String(row.to_date).slice(0, 10) + "T00:00:00").getTime() -
          new Date(String(row.from_date).slice(0, 10) + "T00:00:00").getTime()) / 86400000,
      ) + 1,
    );
    const daysPerCalDay = Number(row.total_days) / calDays;

    for (const date of overlapDates) {
      const daysToRestore = Math.min(daysPerCalDay, 1);
      await restoreLeaveDay({
        employeeId: String(row.employee_id),
        leaveRequestId: String(row.leave_request_id),
        leaveTypeId: String(row.leave_type_id),
        leaveTypeName: String(row.leave_name),
        overlapDate: date,
        daysToRestore,
        runMonth,
        restoredBy: "payroll_lock",
        notes: `Month-end reconciliation for ${runMonth}`,
        employeeUserId: row.user_id ? String(row.user_id) : null,
      });
      totalRestored += daysToRestore;
      employeesAffected.add(String(row.employee_id));
    }
  }

  return { restored: totalRestored, employees: employeesAffected.size };
}
