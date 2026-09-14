import type { RowDataPacket } from "mysql2";
import { db } from "../db/mysql.js";
import { enumerateDates } from "./attendanceSnapshot.js";

/**
 * Authoritative source for "is this calendar date chargeable against an
 * employee's leave balance" — the ONE place both leave submission (day-count
 * validation) and leave approval (attendance write) use, so they can never
 * disagree with each other or with a client-computed preview.
 * (2026-08-13, leave-module audit — policy sign-off on #18/#19.)
 *
 * Mirrors the same holiday/roster-week-off matching rules
 * attendance-engine.service.ts's resolveOverridePriority() uses for
 * attendance grading (branch/cost-centre/designation-scoped holidays,
 * wfm_roster_assignment.is_week_off) — but does NOT check already-approved
 * leave (irrelevant before/at approval, and would be circular during
 * approval itself) and is a pure classification, not a status-priority
 * resolver.
 *
 * IMPORTANT — this decides leave-balance CHARGEABILITY only. Whether a
 * non-chargeable Week Off is PAID is a completely separate question,
 * governed by the existing Week Off eligibility logic in
 * payrollCalculate.service.ts's calculateWeekoffEligibility(). Do not use
 * this function to answer that question, and do not use that function to
 * answer this one — they must stay architecturally separate per policy.
 *
 * PAST-DATE OVERRIDE (user decision, 2026-09-05): roster/holiday is checked
 * first because most leave is applied in ADVANCE, before any attendance
 * exists to look at — there is nothing else available at that point. But for
 * a date already in the past, real attendance exists and is the ground
 * truth: if the roster says Week Off / a calendar says holiday, yet the
 * employee's actual attendance for that exact date is 'absent' or
 * 'missing_punch' (a genuine unaccounted gap, not an excused day), the day
 * IS reclassified back to "chargeable" so a backdated leave entry can cover
 * it. A date whose attendance already says 'week_off'/'holiday'/'present'/
 * 'half_day'/'leave_approved'/'week_off_worked' is left exactly as the
 * roster/holiday check found it — those are accounted-for outcomes, not
 * gaps, and 'unreconciled' is deliberately left alone too: it is still
 * pending resolution, so treating it as a gap could reserve balance against
 * a day the reconciliation engine later turns into something else entirely.
 * Never applies to a future date: there is no attendance to disagree with
 * the roster yet, so the roster's own classification stands unchanged.
 */
export type LeaveDayClassification = "chargeable" | "week_off" | "holiday";

export interface EmployeeLeaveScope {
  branchId: string | null;
  costCentreId: string | null;
  designationId: string | null;
}

export async function getEmployeeLeaveScope(employeeId: string): Promise<EmployeeLeaveScope> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT branch_id, cost_centre_id, designation_id FROM employees WHERE id = ? LIMIT 1`,
    [employeeId]
  );
  const row = (rows as RowDataPacket[])[0] as any;
  return {
    branchId: row?.branch_id ?? null,
    costCentreId: row?.cost_centre_id ?? null,
    designationId: row?.designation_id ?? null,
  };
}

export async function classifyLeaveDays(
  employeeId: string,
  scope: EmployeeLeaveScope,
  fromDate: string,
  toDate: string
): Promise<Map<string, LeaveDayClassification>> {
  const dates = enumerateDates(fromDate, toDate);
  const result = new Map<string, LeaveDayClassification>();
  for (const d of dates) result.set(d, "chargeable");
  if (dates.length === 0) return result;

  // Holidays — branch/cost-centre/designation scoped, same rule set as
  // attendance-engine.service.ts's resolveOverridePriority() (minus its DOJ
  // exclusion, which grades past attendance and doesn't apply to charging
  // leave balance for a request an active employee is submitting now).
  const [holidayRows] = await db.execute<RowDataPacket[]>(
    `SELECT lhm.holiday_date
       FROM leave_holiday_master lhm
      WHERE lhm.holiday_date BETWEEN ? AND ?
        AND lhm.active_status = 1
        AND (lhm.branch_id IS NULL OR lhm.branch_id = ?)
        AND (
          NOT EXISTS (SELECT 1 FROM holiday_cost_centre_mapping WHERE holiday_id = lhm.id)
          OR EXISTS (
            SELECT 1 FROM holiday_cost_centre_mapping hccm
            WHERE hccm.holiday_id = lhm.id AND hccm.cost_centre_id = ?
          )
        )
        AND (
          NOT EXISTS (SELECT 1 FROM holiday_designation_mapping WHERE holiday_id = lhm.id)
          OR EXISTS (
            SELECT 1 FROM holiday_designation_mapping hdm
            WHERE hdm.holiday_id = lhm.id AND hdm.designation_id = ?
          )
        )`,
    [fromDate, toDate, scope.branchId, scope.costCentreId, scope.designationId]
  );
  for (const row of holidayRows as RowDataPacket[]) {
    const d = String((row as any).holiday_date).slice(0, 10);
    result.set(d, "holiday");
  }

  // Roster week-off. is_week_off is the column the roster actually populates
  // (roster_status has historically never held the literal 'Week Off' on
  // live data — see attendance-engine.service.ts's own note — kept here only
  // so a future writer that does use the string still registers).
  const [weekOffRows] = await db.execute<RowDataPacket[]>(
    `SELECT roster_date
       FROM wfm_roster_assignment
      WHERE employee_id = ?
        AND roster_date BETWEEN ? AND ?
        AND (is_week_off = 1 OR roster_status = 'Week Off')`,
    [employeeId, fromDate, toDate]
  );
  for (const row of weekOffRows as RowDataPacket[]) {
    const d = String((row as any).roster_date).slice(0, 10);
    // Holiday takes priority if a date is somehow both — matches
    // attendance-engine's own override order (holiday checked before week-off).
    if (result.get(d) !== "holiday") result.set(d, "week_off");
  }

  // Past-date override — see the PAST-DATE OVERRIDE note on this function.
  // Only worth a query when there is at least one week_off/holiday date to
  // possibly override. "Past" is decided by the DB's own CURDATE(), not a
  // JS Date computed in this process — this repo has been bitten before by
  // a host-timezone Date read as UTC and shifting the day by one.
  const nonChargeableDates = Array.from(result.entries())
    .filter(([, v]) => v !== "chargeable")
    .map(([d]) => d);
  if (nonChargeableDates.length > 0) {
    const [attendanceRows] = await db.execute<RowDataPacket[]>(
      `SELECT record_date, attendance_status
         FROM attendance_daily_record
        WHERE employee_id = ?
          AND record_date IN (${nonChargeableDates.map(() => "?").join(",")})
          AND record_date < CURDATE()
          AND attendance_status IN ('absent', 'missing_punch')`,
      [employeeId, ...nonChargeableDates]
    );
    for (const row of attendanceRows as RowDataPacket[]) {
      const d = String((row as any).record_date).slice(0, 10);
      result.set(d, "chargeable");
    }
  }

  return result;
}

export function countChargeableDays(classification: Map<string, LeaveDayClassification>): number {
  let n = 0;
  for (const v of classification.values()) if (v === "chargeable") n++;
  return n;
}

export function chargeableDates(classification: Map<string, LeaveDayClassification>): string[] {
  return Array.from(classification.entries())
    .filter(([, v]) => v === "chargeable")
    .map(([d]) => d);
}
