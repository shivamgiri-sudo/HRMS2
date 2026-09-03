import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { EMPLOYMENT_END_DATE_SELECT, payableThrough } from "./employment-end-date.js";

// ─── Internal types ───────────────────────────────────────────────────────────

interface EmployeeMasterRow {
  date_of_joining: string;
  salary_start_date: string | null;
  branch_id: string | null;
  process_id: string | null;
  cost_centre_id: string | null;
  designation_id: string | null;
  employment_end_date: string | null;
}

interface HolidayRow {
  id: string;
  holiday_date: string;
  holiday_type: string;
  active_status: number;
}

interface CostCentreRow {
  holiday_id: string;
}


interface ExtraPayoutRow {
  extra_payout: number;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function lastDayOfMonth(runMonth: string): number {
  const [year, month] = runMonth.split("-").map(Number);
  return new Date(year, month, 0).getDate();
}

// ─── V2 implementation ────────────────────────────────────────────────────────

/**
 * Resolves the number of eligible public/national holidays for an employee in
 * the given payroll month, and any approved holiday-work extra payout amount.
 *
 * Eligibility rules applied per holiday:
 *  - holiday_date >= effective salary start date
 *  - holiday_date >= date_of_joining
 *  - No is_mandatory=1 cost-centre override forcing the employee to work
 *  - If designation mappings exist for the holiday, the employee's designation
 *    must be in that list; otherwise all designations are eligible.
 */
export async function resolveHolidaysForEmployeeV2(
  employeeId: string,
  runMonth: string
): Promise<{ eligibleHolidayCount: number; eligibleHolidayDates: string[]; holidayWorkExtraPayout: number }> {
  // ── Step 1: Employee master data ──────────────────────────────────────────
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.date_of_joining, e.salary_start_date, e.branch_id,
            e.process_id, e.cost_centre_id, e.designation_id,
            ${EMPLOYMENT_END_DATE_SELECT} AS employment_end_date
     FROM employees e
     WHERE e.id = ?
     LIMIT 1`,
    [employeeId]
  );

  const emp = (empRows as EmployeeMasterRow[])[0];
  if (!emp) {
    return { eligibleHolidayCount: 0, eligibleHolidayDates: [], holidayWorkExtraPayout: 0 };
  }

  // ── Step 2: Effective salary start date ───────────────────────────────────
  const effectiveSalaryStart = new Date(
    (emp.salary_start_date ?? emp.date_of_joining) as string
  );
  const dateOfJoining = new Date(emp.date_of_joining);

  // ── Step 3: Holidays in this month ────────────────────────────────────────
  const lastDay  = lastDayOfMonth(runMonth);
  const dateFrom = `${runMonth}-01`;
  const dateTo   = `${runMonth}-${String(lastDay).padStart(2, "0")}`;

  // Fetch eligible holidays using the same branch + cost-centre + designation
  // scope rules as attendance-engine.service.ts and leaveChargeableDays.ts.
  //
  // Rule: branch_id IS NULL = applies to all branches; otherwise branch-specific.
  // Cost-centre: NOT EXISTS mapping rows = all employees; EXISTS = must match.
  // Designation: NOT EXISTS mapping rows = all employees; EXISTS = must match.
  // Mandatory-work override (is_mandatory=1) is handled separately in the loop.
  const [holidayRows] = await db.execute<RowDataPacket[]>(
    `SELECT lhm.id, lhm.holiday_date, lhm.holiday_type
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
    [dateFrom, dateTo, emp.branch_id ?? null, emp.cost_centre_id ?? null, emp.designation_id ?? null]
  );

  const holidays = holidayRows as HolidayRow[];
  if (holidays.length === 0) {
    return { eligibleHolidayCount: 0, eligibleHolidayDates: [], holidayWorkExtraPayout: 0 };
  }

  // The last date of this month the employee is payable through: their last working day when
  // it falls inside the month, otherwise month end. Compared as 'YYYY-MM-DD' strings so the
  // result is timezone-independent — a local Date read back as UTC shifts the day, and on a
  // leaver bound that is the difference between granting and withholding a holiday.
  const payableThroughDate = payableThrough(emp.employment_end_date, dateTo);

  // ── Step 4 & 5: Per-holiday eligibility check ─────────────────────────────
  let eligibleHolidayCount = 0;
  const eligibleHolidayDates: string[] = [];

  for (const holiday of holidays) {
    const holidayDate = new Date(holiday.holiday_date);
    const holidayDateStr = String(holiday.holiday_date).slice(0, 10);

    // Date-of-joining and salary start checks
    if (holidayDate < effectiveSalaryStart) continue;
    if (holidayDate < dateOfJoining)        continue;

    // Leaver bound. This resolver had a lower bound but no upper one, so a holiday falling AFTER
    // an employee's last working day was still granted to them: a leaver who finished on the
    // 25th was credited a holiday on the 28th. Since calculateWeekoffEligibility subtracts
    // holidays from available working days, it also judged them against an easier attendance
    // threshold for a month they had already left.
    //
    // Bounded by the same resolver payroll prorates with — exit_request's confirmed or proposed
    // last working day, then date_of_exit, then date_of_leaving — so a leaver cannot be granted
    // a holiday on one definition of their end date and paid on another. date_of_leaving is NULL
    // on every row in this database, which is why it is never read on its own.
    if (holidayDateStr > payableThroughDate) continue;

    // Mandatory-work override: if the employee's branch/process was mandated to work
    // this holiday (is_mandatory=1), it is not a paid holiday for them.
    if (emp.branch_id || emp.process_id) {
      const ccParams: unknown[] = [holiday.id];
      const ccConditions: string[] = ["holiday_id = ?", "is_mandatory = 1"];
      const scopeClauses: string[] = [];
      if (emp.branch_id)  { scopeClauses.push("branch_id = ?");  ccParams.push(emp.branch_id); }
      if (emp.process_id) { scopeClauses.push("process_id = ?"); ccParams.push(emp.process_id); }
      if (scopeClauses.length > 0) ccConditions.push(`(${scopeClauses.join(" OR ")})`);

      const [mandatoryRows] = await db.execute<RowDataPacket[]>(
        `SELECT holiday_id FROM holiday_cost_centre_mapping
         WHERE ${ccConditions.join(" AND ")}
         LIMIT 1`,
        ccParams
      );
      if ((mandatoryRows as CostCentreRow[]).length > 0) continue;
    }

    eligibleHolidayCount++;
    eligibleHolidayDates.push(String(holiday.holiday_date));
  }

  // ── Step 6: Approved holiday-work extra payout ────────────────────────────
  const [payoutRows] = await db.execute<RowDataPacket[]>(
    `SELECT COALESCE(SUM(hwe.payout_amount), 0) AS extra_payout
     FROM holiday_work_request_employee hwe
     JOIN holiday_work_request hwr ON hwr.id = hwe.request_id
     WHERE hwe.employee_id = ?
       AND hwr.status = 'superadmin_approved'
       AND hwe.calculation_status = 'approved'
       AND hwr.id IN (
         SELECT id FROM holiday_work_request
         WHERE holiday_id IN (
           SELECT id FROM leave_holiday_master
           WHERE holiday_date BETWEEN ? AND ?
         )
       )`,
    [employeeId, dateFrom, dateTo]
  );

  const holidayWorkExtraPayout = Number(
    (payoutRows as ExtraPayoutRow[])[0]?.extra_payout ?? 0
  );

  return { eligibleHolidayCount, eligibleHolidayDates, holidayWorkExtraPayout };
}

// ─── Backward-compat export (old callers pass no args) ───────────────────────

/**
 * @deprecated Use resolveHolidaysForEmployeeV2 for payroll computation.
 * Retained for backward compatibility with existing callers that pass no args
 * or rely on the old return shape (array of { eligible: true } objects).
 */
export async function resolveHolidaysForEmployee(
  employeeId?: string,
  runMonth?: string
): Promise<Array<{ eligible: boolean }>> {
  if (!employeeId || !runMonth) return [];
  const result = await resolveHolidaysForEmployeeV2(employeeId, runMonth);
  return Array(result.eligibleHolidayCount).fill({ eligible: true });
}
