import { randomUUID } from "crypto";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LeaveReversalResult {
  reversed: boolean;
  daysReversed: number;
  newPaidBase: number;
  log: {
    leaveRequestId: string;
    leaveTypeId: string;
    leaveDate: string;
    daysReversed: number;
  }[];
}

interface LeaveRequestRow {
  id: string;
  leave_type_id: string;
  from_date: string;
  to_date: string;
  total_days: number;
  is_paid: number;
}

interface BalanceRow {
  balance_days: number; // alias: allocated_days + adjusted_days - used_days
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function lastDayOfMonth(runMonth: string): number {
  const [year, month] = runMonth.split("-").map(Number);
  return new Date(year, month, 0).getDate();
}

/**
 * Calendar days that [leaveFrom..leaveTo] intersects [windowFrom..windowTo].
 * Exported for unit testing.
 */
export function daysIntersectWithMonth(
  leaveFrom: string,
  leaveTo: string,
  windowFrom: string,
  windowTo: string,
): number {
  const start = leaveFrom > windowFrom ? leaveFrom : windowFrom;
  const end   = leaveTo   < windowTo   ? leaveTo   : windowTo;
  if (start > end) return 0;
  return Math.floor((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000) + 1;
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * Checks whether the sum of paid days, eligible week-offs and eligible holidays
 * exceeds the total days in the month. If so, reverses approved paid leave days
 * to bring the payable total within the month cap.
 *
 * Each reversal is audited in leave_reversal_log and sensitive_action_log.
 */
export async function checkAndReverseLeave(params: {
  employeeId: string;
  runId: string;
  runMonth: string;
  paidBase: number;
  eligibleWeekoffs: number;
  eligibleHolidays: number;
  daysInMonth: number;
}): Promise<LeaveReversalResult> {
  const {
    employeeId,
    runId,
    runMonth,
    paidBase,
    eligibleWeekoffs,
    eligibleHolidays,
    daysInMonth,
  } = params;

  // ── Step 1 & 2: Early exit if no overflow ─────────────────────────────────
  const calculatedPayable = paidBase + eligibleWeekoffs + eligibleHolidays;
  if (calculatedPayable <= daysInMonth) {
    return { reversed: false, daysReversed: 0, newPaidBase: paidBase, log: [] };
  }

  // ── Step 3: How many days to claw back ────────────────────────────────────
  let excessDays = calculatedPayable - daysInMonth;

  // ── Step 4: Fetch approved paid leave for this employee in this month ─────
  const lastDay = lastDayOfMonth(runMonth);
  const dateFrom = `${runMonth}-01`;
  const dateTo   = `${runMonth}-${String(lastDay).padStart(2, "0")}`;

  // Use date-range overlap (A<=D AND B>=C) instead of from_date BETWEEN.
  // The old BETWEEN missed cross-month leaves whose from_date preceded the
  // month window even though some of their days fell inside this month.
  const [leaveRows] = await db.execute<RowDataPacket[]>(
    `SELECT lr.id, lr.leave_type_id, lr.from_date, lr.to_date, lr.total_days, lt.paid_leave AS is_paid
     FROM leave_request lr
     JOIN leave_type_master lt ON lt.id = lr.leave_type_id
     WHERE lr.employee_id = ?
       AND lr.status = 'approved'
       AND lt.paid_leave = 1
       AND lr.from_date <= ?
       AND lr.to_date   >= ?
     ORDER BY lr.from_date ASC`,
    [employeeId, dateTo, dateFrom]
  );

  const leaveRequests = leaveRows as LeaveRequestRow[];

  // ── Step 5 & 6: Greedy reversal from most-recent leave backwards ──────────
  // "Most recent" = last in the ASC-ordered list, so iterate in reverse
  const reversedLog: LeaveReversalResult["log"] = [];
  let totalDaysReversed = 0;

  for (let i = leaveRequests.length - 1; i >= 0 && excessDays > 0; i--) {
    const leave = leaveRequests[i];
    // Only the days that actually fall inside this month are payroll-relevant.
    // Reversing the full total_days of a cross-month leave would over-restore
    // balance for days that belong to a different pay period.
    const daysInMonth = daysIntersectWithMonth(
      String(leave.from_date).slice(0, 10),
      String(leave.to_date).slice(0, 10),
      dateFrom,
      dateTo,
    );
    const daysToReverse = Math.min(daysInMonth, excessDays);

    // ── 6a. Current balance (available = allocated + adjusted - used) ─────
    const balanceYear = runMonth.slice(0, 4);
    const [balanceRows] = await db.execute<RowDataPacket[]>(
      `SELECT (COALESCE(allocated_days, 0) + COALESCE(adjusted_days, 0) - COALESCE(used_days, 0)) AS balance_days
       FROM leave_balance_ledger
       WHERE employee_id = ? AND leave_type_id = ? AND balance_year = ?`,
      [employeeId, leave.leave_type_id, balanceYear]
    );
    const balanceBefore = Number((balanceRows as BalanceRow[])[0]?.balance_days ?? 0);
    const balanceAfter  = balanceBefore + daysToReverse;

    // ── 6c. Restore balance by reducing used_days (reverses the deduction
    //        that happened when the leave was approved) ────────────────────
    await db.execute<ResultSetHeader>(
      `UPDATE leave_balance_ledger
       SET used_days = GREATEST(0, used_days - ?)
       WHERE employee_id = ? AND leave_type_id = ? AND balance_year = ?`,
      [daysToReverse, employeeId, leave.leave_type_id, balanceYear]
    );

    // ── 6d. Insert reversal log ────────────────────────────────────────────
    const reversalId = randomUUID();
    await db.execute<ResultSetHeader>(
      `INSERT INTO leave_reversal_log (
         id, employee_id, run_month, leave_request_id, leave_type_id,
         leave_date, original_leave_days, reversed_days, reason,
         balance_before, balance_after, payroll_run_id,
         calculated_payable, month_days_cap
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        reversalId,
        employeeId,
        runMonth,
        leave.id,
        leave.leave_type_id,
        leave.from_date,
        leave.total_days,
        daysToReverse,
        "Payable days exceeded month days due to leave addition",
        balanceBefore,
        balanceAfter,
        runId,
        calculatedPayable,
        daysInMonth,
      ]
    );

    // ── 6e. Insert sensitive action log ───────────────────────────────────
    // Written through the shared helper rather than a raw INSERT: the previous
    // statement named actor_id / old_value / new_value, none of which exist on
    // sensitive_action_log (the real columns are actor_user_id, old_value_json
    // and new_value_json), so it could never have succeeded.
    await logSensitiveAction({
      actor_user_id: "system",
      actor_role: "system",
      action_type: "leave_reversal_payroll",
      module_key: "payroll",
      entity_type: "leave_request",
      entity_id: leave.id,
      employee_id: employeeId,
      reason: `Payroll month cap exceeded; reversed ${daysToReverse} paid leave day(s) for ${runMonth}`,
      old_value_json: { balance_before: balanceBefore, leave_type_id: leave.leave_type_id },
      new_value_json: {
        balance_after: balanceAfter,
        reversed_days: daysToReverse,
        leave_type_id: leave.leave_type_id,
      },
    });

    reversedLog.push({
      leaveRequestId: leave.id,
      leaveTypeId:    leave.leave_type_id,
      leaveDate:      leave.from_date,
      daysReversed:   daysToReverse,
    });

    totalDaysReversed += daysToReverse;
    excessDays        -= daysToReverse;
  }

  // ── Steps 7–9: Build and return result ────────────────────────────────────
  return {
    reversed:     totalDaysReversed > 0,
    daysReversed: totalDaysReversed,
    newPaidBase:  paidBase - totalDaysReversed,
    log:          reversedLog,
  };
}
