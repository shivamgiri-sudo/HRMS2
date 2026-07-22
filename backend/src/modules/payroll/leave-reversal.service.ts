import { randomUUID } from "crypto";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { db } from "../../db/mysql.js";

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

// ─── Helper ───────────────────────────────────────────────────────────────────

function lastDayOfMonth(runMonth: string): number {
  const [year, month] = runMonth.split("-").map(Number);
  return new Date(year, month, 0).getDate();
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

  const [leaveRows] = await db.execute<RowDataPacket[]>(
    `SELECT lr.id, lr.leave_type_id, lr.from_date, lr.to_date, lr.total_days, lt.is_paid
     FROM leave_request lr
     JOIN leave_type_master lt ON lt.id = lr.leave_type_id
     WHERE lr.employee_id = ?
       AND lr.status = 'approved'
       AND lt.is_paid = 1
       AND lr.from_date BETWEEN ? AND ?
     ORDER BY lr.from_date ASC`,
    [employeeId, dateFrom, dateTo]
  );

  const leaveRequests = leaveRows as LeaveRequestRow[];

  // ── Step 5 & 6: Greedy reversal from most-recent leave backwards ──────────
  // "Most recent" = last in the ASC-ordered list, so iterate in reverse
  const reversedLog: LeaveReversalResult["log"] = [];
  let totalDaysReversed = 0;

  for (let i = leaveRequests.length - 1; i >= 0 && excessDays > 0; i--) {
    const leave = leaveRequests[i];
    const daysAvailable = leave.total_days;
    const daysToReverse = Math.min(daysAvailable, excessDays);

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
    await db.execute<ResultSetHeader>(
      `INSERT INTO sensitive_action_log (
         id, actor_id, actor_role, action_type, entity_type, entity_id,
         old_value, new_value, ip_address, user_agent
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        "system",
        "system",
        "leave_reversal_payroll",
        "leave_request",
        leave.id,
        JSON.stringify({ balance_before: balanceBefore, leave_type_id: leave.leave_type_id }),
        JSON.stringify({ balance_after: balanceAfter, reversed_days: daysToReverse, leave_type_id: leave.leave_type_id }),
        "127.0.0.1",
        "payroll-engine",
      ]
    );

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
