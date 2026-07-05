import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

// ─── Internal types ───────────────────────────────────────────────────────────

interface EmployeeMasterRow {
  date_of_joining: string;
  salary_start_date: string | null;
  branch_id: string | null;
  process_id: string | null;
  designation_id: string | null;
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

interface DesignationMappingRow {
  designation_id: string;
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
): Promise<{ eligibleHolidayCount: number; holidayWorkExtraPayout: number }> {
  // ── Step 1: Employee master data ──────────────────────────────────────────
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.date_of_joining, e.salary_start_date, e.branch_id,
            e.process_id, e.designation_id
     FROM employees e
     WHERE e.id = ?
     LIMIT 1`,
    [employeeId]
  );

  const emp = (empRows as EmployeeMasterRow[])[0];
  if (!emp) {
    return { eligibleHolidayCount: 0, holidayWorkExtraPayout: 0 };
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

  const [holidayRows] = await db.execute<RowDataPacket[]>(
    `SELECT lhm.id, lhm.holiday_date, lhm.holiday_type, lhm.active_status
     FROM leave_holiday_master lhm
     WHERE lhm.holiday_date BETWEEN ? AND ?
       AND lhm.active_status = 1`,
    [dateFrom, dateTo]
  );

  const holidays = holidayRows as HolidayRow[];
  if (holidays.length === 0) {
    return { eligibleHolidayCount: 0, holidayWorkExtraPayout: 0 };
  }

  // ── Step 4 & 5: Per-holiday eligibility check ─────────────────────────────
  let eligibleHolidayCount = 0;

  for (const holiday of holidays) {
    const holidayDate = new Date(holiday.holiday_date);

    // Date-of-joining and salary start checks
    if (holidayDate < effectiveSalaryStart) continue;
    if (holidayDate < dateOfJoining)        continue;

    // Cost-centre mandatory work override check
    if (emp.branch_id || emp.process_id) {
      const ccParams: unknown[] = [holiday.id];
      const ccConditions: string[] = ["holiday_id = ?", "is_mandatory = 1"];

      // Build an OR clause for branch_id / process_id scope
      const scopeClauses: string[] = [];
      if (emp.branch_id)  { scopeClauses.push("branch_id = ?");  ccParams.push(emp.branch_id); }
      if (emp.process_id) { scopeClauses.push("process_id = ?"); ccParams.push(emp.process_id); }

      if (scopeClauses.length > 0) {
        ccConditions.push(`(${scopeClauses.join(" OR ")})`);
      }

      const [ccRows] = await db.execute<RowDataPacket[]>(
        `SELECT holiday_id FROM holiday_cost_centre_mapping
         WHERE ${ccConditions.join(" AND ")}
         LIMIT 1`,
        ccParams
      );
      // A mandatory cost-centre override means this employee worked that holiday
      if ((ccRows as CostCentreRow[]).length > 0) continue;
    }

    // Designation mapping check
    const [desigMappingRows] = await db.execute<RowDataPacket[]>(
      `SELECT designation_id
       FROM holiday_designation_mapping
       WHERE holiday_id = ?`,
      [holiday.id]
    );

    const mappedDesignations = (desigMappingRows as DesignationMappingRow[]).map(
      (r) => r.designation_id
    );

    if (mappedDesignations.length > 0) {
      // Restricted to specific designations — employee must be in the list
      if (!emp.designation_id || !mappedDesignations.includes(emp.designation_id)) {
        continue;
      }
    }
    // If no mappings exist, all designations are eligible — fall through

    eligibleHolidayCount++;
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

  return { eligibleHolidayCount, holidayWorkExtraPayout };
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
