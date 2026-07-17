import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { payrollService } from "./payroll.service.js";

interface HolidayWorked {
  holiday_id: string;
  holiday_date: string;
  holiday_name: string;
  worked_minutes: number;
  payout_unit: string;
  payout_amount: number;
  policy_id: string;
}

export interface DetectedHolidayWork {
  eligible: boolean;
  payout: number;
  holidaysWorked: HolidayWorked[];
}

/**
 * Auto-detect and calculate holiday work extra payouts during payroll run.
 * Checks if employee's process has auto-generation enabled, then scans
 * attendance for eligible holidays and calculates payouts based on policy.
 */
export async function detectAndCalculateHolidayWork(
  employeeId: string,
  runMonth: string
): Promise<DetectedHolidayWork> {
  // Step 1: Check if employee's process has auto-generation enabled
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.branch_id, e.process_id FROM employees e WHERE e.id = ? LIMIT 1`,
    [employeeId]
  );

  const emp = (empRows as any[])[0];
  if (!emp) {
    return { eligible: false, payout: 0, holidaysWorked: [] };
  }

  const isEnabled = await isHolidayWorkAutoGenEnabled(emp.process_id, emp.branch_id);
  if (!isEnabled) {
    return { eligible: false, payout: 0, holidaysWorked: [] };
  }

  // Parse month
  const [year, month] = runMonth.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  const monthStart = `${runMonth}-01`;
  const monthEnd = `${runMonth}-${String(lastDay).padStart(2, "0")}`;

  // Step 2: Fetch eligible holidays in this month (branch-scoped)
  const [holidayRows] = await db.execute<RowDataPacket[]>(
    `SELECT lhm.id, lhm.holiday_date, lhm.holiday_name
     FROM leave_holiday_master lhm
     WHERE lhm.holiday_date BETWEEN ? AND ?
       AND lhm.extra_pay_eligible = 1
       AND lhm.active_status = 1
       AND (lhm.branch_id IS NULL OR lhm.branch_id = ?)`,
    [monthStart, monthEnd, emp.branch_id]
  );

  const holidays = (holidayRows as any[]) ?? [];
  if (holidays.length === 0) {
    return { eligible: true, payout: 0, holidaysWorked: [] };
  }

  // Step 3: Check attendance on each eligible holiday
  const holidaysWorked: HolidayWorked[] = [];

  for (const holiday of holidays) {
    // Fetch attendance on holiday date
    const [attRows] = await db.execute<RowDataPacket[]>(
      `SELECT attendance_status, COALESCE(dialler_minutes, raw_minutes, 0) AS worked_minutes
       FROM attendance_daily_record
       WHERE employee_id = ?
         AND record_date = ?
         AND attendance_status IN ('present', 'half_day')
       LIMIT 1`,
      [employeeId, holiday.holiday_date]
    );

    if ((attRows as any[]).length === 0) continue; // Did not work

    const att = (attRows as any[])[0];
    const workedMinutes = Number(att.worked_minutes);

    // Step 4: Fetch policy for employee's scope
    const policy = await getHolidayWorkPolicyForEmployee(employeeId);
    if (!policy) continue;

    // Step 5: Calculate payout
    const dailyRate = await calculateDailyRate(employeeId, policy.payout_basis);
    if (dailyRate === 0) continue;

    let payoutUnit = "none";
    let payoutAmount = 0;

    if (workedMinutes >= policy.min_hours_for_full_day) {
      payoutUnit = "full_day";
      payoutAmount = dailyRate * policy.extra_multiplier;
    } else if (workedMinutes >= policy.min_hours_for_half_day) {
      payoutUnit = "half_day";
      payoutAmount = (dailyRate / 2) * policy.extra_multiplier;
    }

    if (payoutAmount > 0) {
      holidaysWorked.push({
        holiday_id: holiday.id,
        holiday_date: holiday.holiday_date,
        holiday_name: holiday.holiday_name,
        worked_minutes: workedMinutes,
        payout_unit: payoutUnit,
        payout_amount: Math.round(payoutAmount * 100) / 100,
        policy_id: policy.id,
      });
    }
  }

  const totalPayout = holidaysWorked.reduce((sum, h) => sum + h.payout_amount, 0);

  return {
    eligible: true,
    payout: totalPayout,
    holidaysWorked,
  };
}

/**
 * Check if process/branch has auto-generation enabled.
 * Precedence: process > branch > global default (false)
 */
export async function isHolidayWorkAutoGenEnabled(
  processId: string | null,
  branchId: string | null
): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT config_value FROM payroll_config_flags
     WHERE config_key = 'holiday_work_extra_pay_enabled'
       AND (process_id = ? OR process_id IS NULL)
       AND (branch_id = ? OR branch_id IS NULL)
     ORDER BY (process_id IS NOT NULL) DESC, (branch_id IS NOT NULL) DESC
     LIMIT 1`,
    [processId ?? null, branchId ?? null]
  );

  return (rows as any[]).length > 0 && (rows as any[])[0].config_value === "true";
}

/**
 * Get holiday work policy for employee.
 * Precedence: process > branch > global
 */
async function getHolidayWorkPolicyForEmployee(employeeId: string): Promise<any> {
  const [policyRows] = await db.execute<RowDataPacket[]>(
    `SELECT hwpm.* FROM holiday_work_policy_master hwpm
     WHERE hwpm.is_active = 1
       AND (hwpm.effective_from <= CURDATE() AND (hwpm.effective_to IS NULL OR hwpm.effective_to >= CURDATE()))
       AND (
         hwpm.process_id = (SELECT process_id FROM employees WHERE id = ?) OR
         hwpm.branch_id = (SELECT branch_id FROM employees WHERE id = ?) OR
         (hwpm.process_id IS NULL AND hwpm.branch_id IS NULL)
       )
     ORDER BY
       (hwpm.process_id IS NOT NULL) DESC,
       (hwpm.branch_id IS NOT NULL) DESC
     LIMIT 1`,
    [employeeId, employeeId]
  );

  return (policyRows as any[]).length > 0 ? (policyRows as any[])[0] : null;
}

/**
 * Calculate daily rate based on payout basis and employee salary.
 */
async function calculateDailyRate(employeeId: string, basis: string): Promise<number> {
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT esa.ctc_annual, esa.structure_id, ss.basic_pct, ss.hra_pct
     FROM employees e
     JOIN employee_salary_assignment esa ON esa.employee_id = e.id AND esa.active_status = 1
     JOIN salary_structure_master ss ON ss.id = esa.structure_id
     WHERE e.id = ?
     LIMIT 1`,
    [employeeId]
  );

  if ((empRows as any[]).length === 0) return 0;

  const emp = (empRows as any[])[0];

  // Read fixed component amounts directly
  const [compRows] = await db.execute<RowDataPacket[]>(
    `SELECT scm.component_code, ssc.calc_type, ssc.value
       FROM salary_structure_component ssc
       JOIN salary_component_master scm ON scm.id = ssc.component_id
      WHERE ssc.structure_id = ?
      ORDER BY ssc.sequence`,
    [emp.structure_id],
  );
  const compAmounts: Record<string, number> = {};
  for (const c of compRows as any[]) {
    if (c.calc_type === 'fixed' || c.calc_type === 'pct_of_ctc') {
      compAmounts[c.component_code] = Number(c.value) || 0;
    }
  }
  const hasFixed = compAmounts.BASIC !== undefined && compAmounts.BASIC > 0;
  const fixedBasic = compAmounts.BASIC || 0;
  const fixedHRA = compAmounts.HRA || 0;
  const fixedGross = hasFixed
    ? (fixedBasic + fixedHRA + (compAmounts.BONUS || 0) + (compAmounts.CONV || 0) +
       (compAmounts.PORTFOLIO || 0) + (compAmounts.MEDICAL || 0) + (compAmounts.LTA || 0) +
       (compAmounts.SPECIAL || 0) + (compAmounts.OTHER_ALLOW || 0) + (compAmounts.PLI || 0))
    : 0;

  const monthlyGross = hasFixed ? fixedGross : (emp.ctc_annual / 12);
  const basic = hasFixed ? fixedBasic : monthlyGross * (emp.basic_pct / 100);
  const effectiveBasicPct = hasFixed ? (fixedBasic / monthlyGross) * 100 : emp.basic_pct;
  const effectiveHraPct = hasFixed ? (fixedHRA / monthlyGross) * 100 : (emp.hra_pct || 0);

  switch (basis) {
    case "NET_DAILY": {
      const calc = payrollService.calculateNetSalary({
        grossMonthlyCTC: monthlyGross,
        workingDays: 30,
        lwpDays: 0,
        pfEmployeePct: 12,
        esicEmployeePct: 0.75,
        esicWageLimit: 21000,
        pfWageLimit: 15000,
        professionalTax: 200,
        tds: 0,
        basicPct: effectiveBasicPct,
        hraPct: effectiveHraPct,
        pfOptOut: false,
        esicOptOut: false,
      });
      return calc.net_salary / 30;
    }
    case "GROSS_DAILY":
      return monthlyGross / 30;
    case "BASIC_DAILY":
      return basic / 30;
    case "FIXED_AMOUNT":
      // Fixed amount handled separately in policy
      return 0;
    default:
      return monthlyGross / 30;
  }
}
