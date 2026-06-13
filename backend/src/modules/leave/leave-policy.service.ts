import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

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
  const CAP = 2;
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
    const params: unknown[] = [employeeId, year, month, year, month, year, month];
    if (excludeRequestId) params.push(excludeRequestId);

    const sql = `
      SELECT COALESCE(SUM(lr.total_days), 0) AS used_days
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
async function checkELOccurrences(
  employeeId: string,
  year: number
): Promise<{ count: number; isException: boolean }> {
  const sql = `
    SELECT COUNT(*) AS cnt
    FROM leave_request lr
    WHERE lr.employee_id = ?
      AND lr.leave_type_id IN (
        SELECT id FROM leave_type_master WHERE leave_code = 'EL'
      )
      AND lr.status IN ('approved', 'pending', 'pending_branch_head')
      AND YEAR(lr.from_date) = ?
  `;

  const [rows] = await db.execute<RowDataPacket[]>(sql, [employeeId, year]);
  const count = Number(rows[0]?.cnt ?? 0);

  // isException = would become the 3rd application (count >= 2 existing)
  return { count, isException: count >= 2 };
}

// ---------------------------------------------------------------------------
// checkELSingleGoCap
// ---------------------------------------------------------------------------
function checkELSingleGoCap(requestedDays: number): { exceeded: boolean; cap: number } {
  const CAP = 12;
  return { exceeded: requestedDays > CAP, cap: CAP };
}

// ---------------------------------------------------------------------------
// requiresBranchHeadApproval
// ---------------------------------------------------------------------------
async function requiresBranchHeadApproval(
  employeeId: string,
  requestedDays: number,
  year: number
): Promise<boolean> {
  if (requestedDays > 12) return true;

  const { isException } = await checkELOccurrences(employeeId, year);
  return isException;
}

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
// Named export
// ---------------------------------------------------------------------------
export const leavePolicyService = {
  checkMonthlyCapExceeded,
  checkCLMLInSameMonth,
  checkELInSameMonth,
  checkELOccurrences,
  checkELSingleGoCap,
  requiresBranchHeadApproval,
  prorateMonthlyCredit,
  prorateAnnualCredit,
};
