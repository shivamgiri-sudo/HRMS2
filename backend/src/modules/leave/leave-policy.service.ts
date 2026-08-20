import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { getPolicyValue } from "../policy-engine/policy-engine.cache.js";

// ---------------------------------------------------------------------------
// Helper: get all calendar months (as { year, month } objects) spanned by
// [fromDate..toDate] inclusive.
// ---------------------------------------------------------------------------
function getMonthsInRange(
  fromDate: string,
  toDate: string
): Array<{ year: number; month: number }> {
  const from = new Date(fromDate);
  const to = new Date(toDate);
  const months: Array<{ year: number; month: number }> = [];

  let year = from.getFullYear();
  let month = from.getMonth() + 1; // 1-indexed

  const toYear = to.getFullYear();
  const toMonth = to.getMonth() + 1;

  while (year < toYear || (year === toYear && month <= toMonth)) {
    months.push({ year, month });
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }

  return months;
}

// ---------------------------------------------------------------------------
// checkMonthlyCapExceeded
// ---------------------------------------------------------------------------

// Helper: count calendar days in [start..end] inclusive.
function daysInRange(start: Date, end: Date): number {
  const diff = end.getTime() - start.getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)) + 1);
}

async function checkMonthlyCapExceeded(
  employeeId: string,
  fromDate: string,
  toDate: string,
  requestedDays: number,
  excludeRequestId?: string
): Promise<{ exceeded: boolean; monthBreached: string | null; usedDays: number; cap: number }> {
  const CAP = Number(await getPolicyValue("leave", "cl_ml_policy", "monthly_cap_days", "1"));
  const months = getMonthsInRange(fromDate, toDate);

  for (const { year, month } of months) {
    // Compute how many of the requested days fall within this specific month
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0); // last day of month
    const requestStart = new Date(fromDate);
    const requestEnd = new Date(toDate);
    const overlapStart = requestStart > monthStart ? requestStart : monthStart;
    const overlapEnd = requestEnd < monthEnd ? requestEnd : monthEnd;
    const daysInThisMonth = daysInRange(overlapStart, overlapEnd);

    const excludeClause = excludeRequestId ? "AND lr.id != ?" : "";
    // param order matches the SQL:
    //   LEAST(to_date, LAST_DAY(y-m))         → year, month  (1-2)
    //   GREATEST(from_date, y-m-01)            → year, month  (3-4)
    //   employee_id                            → (5)
    //   overlap window LAST_DAY(y-m)           → year, month  (6-7)
    //   overlap window y-m-01                  → year, month  (8-9)
    const params: unknown[] = [year, month, year, month, employeeId, year, month, year, month];
    if (excludeRequestId) params.push(excludeRequestId);

    // Count only the calendar days that each existing request overlaps with
    // this specific month — not total_days, which over-counts cross-month
    // leaves by including days that belong to adjacent pay periods.
    const sql = `
      SELECT COALESCE(SUM(
        DATEDIFF(
          LEAST(lr.to_date,   LAST_DAY(CONCAT(?, '-', LPAD(?, 2, '0'), '-01'))),
          GREATEST(lr.from_date, CONCAT(?, '-', LPAD(?, 2, '0'), '-01'))
        ) + 1
      ), 0) AS used_days
      FROM leave_request lr
      WHERE lr.employee_id = ?
        AND lr.leave_type_id IN (
          SELECT id FROM leave_type_master WHERE leave_code IN ('CL', 'ML')
        )
        AND lr.status IN ('approved', 'pending', 'pending_branch_head')
        AND (
          lr.from_date <= LAST_DAY(CONCAT(?, '-', LPAD(?, 2, '0'), '-01'))
          AND lr.to_date >= CONCAT(?, '-', LPAD(?, 2, '0'), '-01')
        )
        ${excludeClause}
    `;

    const [rows] = await db.execute<RowDataPacket[]>(sql, params);
    const usedDays = Number(rows[0]?.used_days ?? 0);

    if (usedDays + daysInThisMonth > CAP) {
      const monthBreached = `${year}-${String(month).padStart(2, "0")}`;
      return { exceeded: true, monthBreached, usedDays, cap: CAP };
    }
  }

  return { exceeded: false, monthBreached: null, usedDays: 0, cap: CAP };
}

// ---------------------------------------------------------------------------
// checkCLMLInSameMonth
// ---------------------------------------------------------------------------
async function checkCLMLInSameMonth(
  employeeId: string,
  fromDate: string,
  toDate: string,
  excludeRequestId?: string
): Promise<{ hasConflict: boolean; conflictMonth: string | null }> {
  const months = getMonthsInRange(fromDate, toDate);

  for (const { year, month } of months) {
    const excludeClause = excludeRequestId ? "AND lr.id != ?" : "";
    const params: unknown[] = [employeeId, year, month, year, month, year, month];
    if (excludeRequestId) params.push(excludeRequestId);

    const sql = `
      SELECT COUNT(*) AS cnt
      FROM leave_request lr
      WHERE lr.employee_id = ?
        AND lr.leave_type_id IN (
          SELECT id FROM leave_type_master WHERE leave_code IN ('CL', 'ML')
        )
        AND lr.status IN ('approved', 'pending', 'pending_branch_head')
        AND (
          lr.from_date <= LAST_DAY(CONCAT(?, '-', LPAD(?, 2, '0'), '-01'))
          AND lr.to_date >= CONCAT(?, '-', LPAD(?, 2, '0'), '-01')
        )
        ${excludeClause}
    `;

    const [rows] = await db.execute<RowDataPacket[]>(sql, params);
    const cnt = Number(rows[0]?.cnt ?? 0);

    if (cnt > 0) {
      const conflictMonth = `${year}-${String(month).padStart(2, "0")}`;
      return { hasConflict: true, conflictMonth };
    }
  }

  return { hasConflict: false, conflictMonth: null };
}

// ---------------------------------------------------------------------------
// checkELInSameMonth
// ---------------------------------------------------------------------------
async function checkELInSameMonth(
  employeeId: string,
  fromDate: string,
  toDate: string,
  excludeRequestId?: string
): Promise<{ hasConflict: boolean; conflictMonth: string | null }> {
  const months = getMonthsInRange(fromDate, toDate);

  for (const { year, month } of months) {
    const excludeClause = excludeRequestId ? "AND lr.id != ?" : "";
    const params: unknown[] = [employeeId, year, month, year, month, year, month];
    if (excludeRequestId) params.push(excludeRequestId);

    const sql = `
      SELECT COUNT(*) AS cnt
      FROM leave_request lr
      WHERE lr.employee_id = ?
        AND lr.leave_type_id IN (
          SELECT id FROM leave_type_master WHERE leave_code = 'EL'
        )
        AND lr.status IN ('approved', 'pending', 'pending_branch_head')
        AND (
          lr.from_date <= LAST_DAY(CONCAT(?, '-', LPAD(?, 2, '0'), '-01'))
          AND lr.to_date >= CONCAT(?, '-', LPAD(?, 2, '0'), '-01')
        )
        ${excludeClause}
    `;

    const [rows] = await db.execute<RowDataPacket[]>(sql, params);
    const cnt = Number(rows[0]?.cnt ?? 0);

    if (cnt > 0) {
      const conflictMonth = `${year}-${String(month).padStart(2, "0")}`;
      return { hasConflict: true, conflictMonth };
    }
  }

  return { hasConflict: false, conflictMonth: null };
}

// ---------------------------------------------------------------------------
// checkELOccurrences
// ---------------------------------------------------------------------------
// CORRECTED (#14, policy sign-off 2026-08-13): previously took a single
// `year` and matched only `YEAR(lr.from_date) = ?`, so a Dec/Jan-spanning EL
// request was attributed entirely to from_date's year for occurrence-
// counting purposes, same root cause as #12's balance-year bug. Now takes
// the new request's own from/to date range, determines every calendar year
// it touches, and reports an exception if ANY of those years would reach
// its 3rd occurrence — an employee taking EL across a year boundary is
// genuinely taking EL in both years, so both years' counts are relevant.
async function checkELOccurrences(
  employeeId: string,
  fromDate: string,
  toDate: string
): Promise<{ count: number; isException: boolean }> {
  const fromYear = new Date(fromDate).getFullYear();
  const toYear = new Date(toDate).getFullYear();
  let maxCount = 0;
  let isException = false;

  for (let year = fromYear; year <= toYear; year++) {
    const sql = `
      SELECT COUNT(*) AS cnt
      FROM leave_request lr
      WHERE lr.employee_id = ?
        AND lr.leave_type_id IN (
          SELECT id FROM leave_type_master WHERE leave_code = 'EL'
        )
        AND lr.status IN ('approved', 'pending', 'pending_branch_head')
        AND lr.from_date <= ?
        AND lr.to_date   >= ?
    `;
    const [rows] = await db.execute<RowDataPacket[]>(
      sql, [employeeId, `${year}-12-31`, `${year}-01-01`]
    );
    const count = Number(rows[0]?.cnt ?? 0);
    maxCount = Math.max(maxCount, count);
    // isException = would become the 3rd application (count >= 2 existing) in this year
    if (count >= 2) isException = true;
  }

  return { count: maxCount, isException };
}

// ---------------------------------------------------------------------------
// checkELSingleGoCap
// ---------------------------------------------------------------------------
function checkELSingleGoCap(requestedDays: number): { exceeded: boolean; cap: number } {
  const CAP = 12;
  return { exceeded: requestedDays > CAP, cap: CAP };
}

// requiresBranchHeadApproval was removed 2026-08-13 (leave-module audit,
// "fix immediately" follow-up): it was dead code (exported, zero callers)
// whose ">12 days -> Branch Head" rule was never actually live —
// submitRequest (leave.service.ts) hard-REJECTS a single EL application over
// 12 days via checkELSingleGoCap instead of escalating it. Retired rather
// than activated, since no policy beyond the 3rd-occurrence-in-a-year rule
// (checkELOccurrences, still live and called directly from leave.service.ts)
// was ever confirmed — activating a new escalation tier would mean inventing
// business policy that was never asked for.

// ---------------------------------------------------------------------------
// prorateMonthlyCredit
// ---------------------------------------------------------------------------
function prorateMonthlyCredit(
  joinDate: string,
  creditMonth: number,
  creditYear: number
): number {
  const parsed = new Date(joinDate);
  const joinYear = parsed.getFullYear();
  const joinMonth = parsed.getMonth() + 1; // 1-indexed
  const joinDay = parsed.getDate();

  // Already employed for the full credit month
  if (joinYear < creditYear || (joinYear === creditYear && joinMonth < creditMonth)) {
    return 1.0;
  }

  // Joined in the exact credit month — prorate
  if (joinYear === creditYear && joinMonth === creditMonth) {
    // JS: new Date(year, month, 0) gives last day of month (month is 1-indexed here, day 0 = last day of prev month)
    const daysInMonth = new Date(creditYear, creditMonth, 0).getDate();
    const daysRemaining = daysInMonth - joinDay + 1;
    return Math.round((daysRemaining / daysInMonth) * 100) / 100;
  }

  // Joined after the credit month — no credit
  return 0;
}

// ---------------------------------------------------------------------------
// prorateAnnualCredit
// ---------------------------------------------------------------------------
function prorateAnnualCredit(
  joinDate: string,
  creditYear: number
): { daysToCredit: number; monthsServed: number } {
  const parsed = new Date(joinDate);
  const joinYear = parsed.getFullYear();
  const joinMonth = parsed.getMonth() + 1; // 1-indexed

  const priorYear = creditYear - 1;

  let monthsServed: number;

  if (joinYear < priorYear) {
    monthsServed = 12;
  } else if (joinYear === priorYear) {
    // months from join month to December, inclusive
    monthsServed = 12 - joinMonth + 1;
  } else {
    // joined in creditYear or later — no prior-year service
    monthsServed = 0;
  }

  const daysToCredit = Math.round((18 * monthsServed) / 12 * 100) / 100;

  return { daysToCredit, monthsServed };
}

// ---------------------------------------------------------------------------
// getCombinedCLMLBalance
// ---------------------------------------------------------------------------
// SUPERSEDED (2026-08-13, leave-module audit — #7 policy sign-off): real
// CL/ML pooling (CL-first, ML-remainder, per this pair's own source-of-truth
// design doc) is now implemented directly in leave.service.ts's
// reviewRequest() approval branch, applied automatically whenever the
// requested type's own balance is insufficient. This function — a plain sum
// with no deduction-order logic — was the prior, unused, non-functional
// stand-in; kept for now as a display-only "combined available" helper
// (still exported, still has zero callers) rather than removed outright.
async function getCombinedCLMLBalance(
  employeeId: string,
  year: number
): Promise<{ available: number; clAllocated: number; clUsed: number; mlAllocated: number; mlUsed: number }> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT lt.leave_code,
            COALESCE(lbl.allocated_days, 0) AS allocated_days,
            COALESCE(lbl.used_days, 0) AS used_days,
            COALESCE(lbl.adjusted_days, 0) AS adjusted_days
     FROM leave_type_master lt
     LEFT JOIN leave_balance_ledger lbl
       ON lbl.leave_type_id = lt.id
       AND lbl.employee_id = ?
       AND lbl.balance_year = ?
     WHERE lt.leave_code IN ('CL', 'ML') AND lt.active_status = 1`,
    [employeeId, year]
  );

  let clAllocated = 0, clUsed = 0, mlAllocated = 0, mlUsed = 0;
  for (const row of rows as RowDataPacket[]) {
    if (row.leave_code === 'CL') {
      clAllocated = Number(row.allocated_days) + Number(row.adjusted_days);
      clUsed = Number(row.used_days);
    } else if (row.leave_code === 'ML') {
      mlAllocated = Number(row.allocated_days) + Number(row.adjusted_days);
      mlUsed = Number(row.used_days);
    }
  }

  const available = (clAllocated - clUsed) + (mlAllocated - mlUsed);
  return { available, clAllocated, clUsed, mlAllocated, mlUsed };
}

// ---------------------------------------------------------------------------
// getExceptionApproverRole
// ---------------------------------------------------------------------------
// Single source of truth for "who must sign off on an escalated
// (pending_branch_head-tier) request", read from leave_policy_config so a
// future policy change takes effect without a code change. Previously
// duplicated in leave.secure.routes.ts (the authorization check) with no
// second caller; now also used by leave.service.ts's submit-time
// notification so the two never disagree about who the escalation goes to.
async function getExceptionApproverRole(leaveTypeId: string | null): Promise<string> {
  if (!leaveTypeId) return "branch_head";
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT exception_approver_role FROM leave_policy_config WHERE leave_type_id = ? LIMIT 1`,
      [leaveTypeId]
    );
    const role = (rows[0] as any)?.exception_approver_role;
    return typeof role === "string" && role.trim() ? role.trim() : "branch_head";
  } catch {
    return "branch_head";
  }
}

// ---------------------------------------------------------------------------
// Named export
// ---------------------------------------------------------------------------
export const leavePolicyService = {
  checkMonthlyCapExceeded,
  checkCLMLInSameMonth,
  checkELInSameMonth,
  checkELOccurrences,
  checkELSingleGoCap,
  prorateMonthlyCredit,
  prorateAnnualCredit,
  getCombinedCLMLBalance,
  getExceptionApproverRole,
};
