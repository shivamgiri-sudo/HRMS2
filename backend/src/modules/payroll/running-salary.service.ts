import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2/promise";
import { resolveHolidaysForEmployee } from "./holiday-work.service.js";
import { payrollService } from "./payroll.service.js";

// ─── Running salary helpers ───────────────────────────────────────────────────

interface RunningConfig {
  weekoffEarningRequired: boolean;
  workingDaysPerWeekoff: number;
}

async function getRunningConfig(branchId?: string, processId?: string): Promise<RunningConfig> {
  const fetch = async (key: string): Promise<string> => {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT config_value FROM payroll_config_flags
       WHERE config_key = ?
         AND (branch_id = ? OR branch_id IS NULL)
         AND (process_id = ? OR process_id IS NULL)
       ORDER BY (branch_id IS NOT NULL) DESC, (process_id IS NOT NULL) DESC
       LIMIT 1`,
      [key, branchId ?? null, processId ?? null],
    );
    return (rows[0] as any)?.config_value ?? "";
  };
  return {
    weekoffEarningRequired: (await fetch("weekoff_earning_required")) !== "false",
    workingDaysPerWeekoff:  parseInt(await fetch("working_days_required_for_one_weekoff") || "6", 10),
  };
}

/**
 * Compute earned salary till today for a payroll line.
 * Uses only confirmed (completed) attendance rows up to as-of date.
 */
export async function computeRunningSalary(
  employeeId: string,
  runMonth: string, // YYYY-MM-01
  asOfDate?: string, // defaults to today
): Promise<{
  earned_payable_days: number;
  eligible_weekoff_till_date: number;
  eligible_holiday_till_date: number;
  earned_salary_till_date: number;
  earned_net_till_date: number;
  projected_payable_days: number;
  projected_salary: number;
  projected_net: number;
  pf_employee: number;
  esic_employee: number;
  professional_tax: number;
}> {
  const today = asOfDate ?? new Date().toISOString().slice(0, 10);
  const monthStart = runMonth;
  const [y, m] = runMonth.split("-").map(Number);
  const monthEnd = new Date(y, m, 0).toISOString().slice(0, 10); // last day of month

  // Get employee salary info
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.branch_id, e.process_id,
            esa.ctc_annual,
            ss.basic_pct, ss.hra_pct,
            bm.state AS state_code
       FROM employees e
       JOIN employee_salary_assignment esa ON esa.employee_id = e.id AND esa.active_status = 1
       JOIN salary_structure_master ss     ON ss.id = esa.structure_id
       LEFT JOIN branch_master bm          ON bm.id = e.branch_id
      WHERE e.id = ?
      LIMIT 1`,
    [employeeId],
  );
  const emp = (empRows[0] as any);
  if (!emp) return _zeroResult();

  // Statutory config for deductions
  const [statKvRows] = await db.execute<RowDataPacket[]>(
    `SELECT config_key, config_value FROM statutory_config`,
  );
  const statConfig: Record<string, number> = {};
  for (const r of statKvRows as any[]) {
    statConfig[String(r.config_key).toLowerCase()] = Number(r.config_value);
  }
  const pfEmployeePct  = statConfig["pf_employee_pct"]   ?? 12;
  const esicEmpPct     = statConfig["esic_employee_pct"] ?? 0.75;
  const esicWageLimit  = statConfig["esic_wage_limit"]   ?? 21000;
  const pfWageLimit    = statConfig["pf_wage_limit"]     ?? 15000;
  const defaultPt      = statConfig["professional_tax"]  ?? 200;

  // Check PF / ESI opt-outs
  const [overrideRows] = await db.execute<RowDataPacket[]>(
    `SELECT override_type FROM employee_statutory_override
     WHERE employee_id = ? AND status = 'approved'`,
    [employeeId],
  );
  const pfOptOut   = (overrideRows as any[]).some((r: any) => r.override_type === "pf_opt_out");
  const esicOptOut = (overrideRows as any[]).some((r: any) => r.override_type === "esic_opt_out");

  // Professional tax from slab if state is known
  const { getPtFromSlab } = await import("./payrollCalculate.service.js");

  const monthlyGross = emp.ctc_annual / 12;

  const config = await getRunningConfig(emp.branch_id, emp.process_id);

  // Active calendar days (handling mid-month joins/exits)
  const activeCalDays = await _activeCalendarDays(employeeId, runMonth);

  // ── Attendance up to today ────────────────────────────────────────────────
  const [attRows] = await db.execute<RowDataPacket[]>(
    `SELECT attendance_status, lwp_value, record_date
       FROM attendance_daily_record
      WHERE employee_id = ?
        AND record_date >= ? AND record_date <= ?`,
    [employeeId, monthStart, today < monthEnd ? today : monthEnd],
  );

  let presentTillDate = 0;
  let paidLeaveTillDate = 0;
  let lwpTillDate = 0;
  let weekoffRosteredTillDate = 0;

  for (const r of attRows as any[]) {
    switch (r.attendance_status) {
      case "present":        presentTillDate += 1; break;
      case "half_day":       presentTillDate += 0.5; lwpTillDate += 0.5; break;
      case "leave_approved": paidLeaveTillDate += 1; break;
      case "week_off":       weekoffRosteredTillDate += 1; break;
      case "absent":         lwpTillDate += 1; break;
    }
  }

  const paidWorkingDaysTillDate = presentTillDate + paidLeaveTillDate;

  // Eligible week-offs till date
  let eligibleWeekoffTillDate: number;
  if (config.weekoffEarningRequired) {
    const earned = Math.floor(paidWorkingDaysTillDate / config.workingDaysPerWeekoff);
    eligibleWeekoffTillDate = Math.min(weekoffRosteredTillDate, earned);
  } else {
    eligibleWeekoffTillDate = weekoffRosteredTillDate;
  }

  // Eligible holidays till date
  let eligibleHolidaysTillDate = 0;
  const dateIter = new Date(monthStart);
  const tillD = new Date(today < monthEnd ? today : monthEnd);
  while (dateIter <= tillD) {
    const d = dateIter.toISOString().slice(0, 10);
    const hols = await resolveHolidaysForEmployee(employeeId, d);
    if (hols.length > 0) eligibleHolidaysTillDate += 1;
    dateIter.setDate(dateIter.getDate() + 1);
  }

  const earnedPayableDays = presentTillDate + paidLeaveTillDate + eligibleWeekoffTillDate +
    eligibleHolidaysTillDate - lwpTillDate;
  const cappedEarned = Math.min(Math.max(0, earnedPayableDays), activeCalDays);

  const earnedSalaryTillDate = (monthlyGross / activeCalDays) * cappedEarned;

  // Prorated deductions on earned gross
  const ptEarned = emp.state_code
    ? await getPtFromSlab(emp.state_code, earnedSalaryTillDate)
    : defaultPt;
  const earnedCalc = payrollService.calculateNetSalary({
    grossMonthlyCTC: earnedSalaryTillDate,
    workingDays: Math.max(1, cappedEarned),
    lwpDays: 0, // LWP already baked into cappedEarned
    pfEmployeePct, esicEmployeePct: esicEmpPct, esicWageLimit, pfWageLimit,
    professionalTax: ptEarned,
    tds: 0,
    basicPct: emp.basic_pct ?? 40,
    hraPct: emp.hra_pct ?? 20,
    pfOptOut, esicOptOut,
  });

  // ── Projection ────────────────────────────────────────────────────────────
  // Future days from roster
  const [futureRoster] = await db.execute<RowDataPacket[]>(
    `SELECT roster_status, roster_date
       FROM wfm_roster_assignment
      WHERE employee_id = ? AND roster_date > ? AND roster_date <= ?`,
    [employeeId, today, monthEnd],
  );

  let futurePresent = 0;
  let futureWeekoffRostered = 0;
  for (const r of futureRoster as any[]) {
    if (r.roster_status === "Rostered") futurePresent += 1;
    else if (r.roster_status === "Week Off") futureWeekoffRostered += 1;
  }

  // Future holidays
  let futureHolidays = 0;
  const futureStart = new Date(today);
  futureStart.setDate(futureStart.getDate() + 1);
  const monthEndD = new Date(monthEnd);
  while (futureStart <= monthEndD) {
    const d = futureStart.toISOString().slice(0, 10);
    const hols = await resolveHolidaysForEmployee(employeeId, d);
    if (hols.length > 0) futureHolidays += 1;
    futureStart.setDate(futureStart.getDate() + 1);
  }

  const projectedPaidWorkingDays = paidWorkingDaysTillDate + futurePresent;
  let projectedEligibleWeekoffs: number;
  if (config.weekoffEarningRequired) {
    const projEarned = Math.floor(projectedPaidWorkingDays / config.workingDaysPerWeekoff);
    projectedEligibleWeekoffs = Math.min(weekoffRosteredTillDate + futureWeekoffRostered, projEarned);
  } else {
    projectedEligibleWeekoffs = weekoffRosteredTillDate + futureWeekoffRostered;
  }

  const projectedPayableDaysRaw = presentTillDate + paidLeaveTillDate +
    projectedEligibleWeekoffs + eligibleHolidaysTillDate + futureHolidays +
    futurePresent - lwpTillDate;
  const projectedPayableDays = Math.min(Math.max(0, projectedPayableDaysRaw), activeCalDays);
  const projectedSalary = (monthlyGross / activeCalDays) * projectedPayableDays;

  // Prorated deductions on projected gross
  const ptProjected = emp.state_code
    ? await getPtFromSlab(emp.state_code, projectedSalary)
    : defaultPt;
  const projectedCalc = payrollService.calculateNetSalary({
    grossMonthlyCTC: projectedSalary,
    workingDays: Math.max(1, projectedPayableDays),
    lwpDays: 0,
    pfEmployeePct, esicEmployeePct: esicEmpPct, esicWageLimit, pfWageLimit,
    professionalTax: ptProjected,
    tds: 0,
    basicPct: emp.basic_pct ?? 40,
    hraPct: emp.hra_pct ?? 20,
    pfOptOut, esicOptOut,
  });

  return {
    earned_payable_days: cappedEarned,
    eligible_weekoff_till_date: eligibleWeekoffTillDate,
    eligible_holiday_till_date: eligibleHolidaysTillDate,
    earned_salary_till_date: Math.round(earnedSalaryTillDate * 100) / 100,
    earned_net_till_date: Math.round(earnedCalc.net_salary * 100) / 100,
    projected_payable_days: projectedPayableDays,
    projected_salary: Math.round(projectedSalary * 100) / 100,
    projected_net: Math.round(projectedCalc.net_salary * 100) / 100,
    pf_employee: Math.round(earnedCalc.pf_employee * 100) / 100,
    esic_employee: Math.round(earnedCalc.esic_employee * 100) / 100,
    professional_tax: Math.round(earnedCalc.professional_tax * 100) / 100,
  };
}

async function _activeCalendarDays(employeeId: string, runMonth: string): Promise<number> {
  const [y, m] = runMonth.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT salary_start_date, date_of_leaving FROM employees WHERE id = ? LIMIT 1`,
    [employeeId],
  );
  const emp = (rows[0] as any);
  const monthStart = runMonth;
  const monthEnd = `${runMonth.slice(0, 7)}-${String(lastDay).padStart(2, "0")}`;

  const effectiveStart = emp?.salary_start_date
    ? (emp.salary_start_date > monthStart ? emp.salary_start_date : monthStart)
    : monthStart;
  const effectiveEnd = emp?.date_of_leaving
    ? (emp.date_of_leaving < monthEnd ? emp.date_of_leaving : monthEnd)
    : monthEnd;

  const start = new Date(effectiveStart);
  const end = new Date(effectiveEnd);
  const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  return Math.max(1, Math.min(days, lastDay));
}

function _zeroResult() {
  return {
    earned_payable_days: 0,
    eligible_weekoff_till_date: 0,
    eligible_holiday_till_date: 0,
    earned_salary_till_date: 0,
    earned_net_till_date: 0,
    projected_payable_days: 0,
    projected_salary: 0,
    projected_net: 0,
    pf_employee: 0,
    esic_employee: 0,
    professional_tax: 0,
  };
}
