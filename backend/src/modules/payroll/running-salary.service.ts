import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2/promise";
import { resolveHolidaysForEmployee } from "./holiday-work.service.js";
import { payrollService } from "./payroll.service.js";
import { calculateWeekoffEligibility } from "./weekoff-eligibility.service.js";

// ─── Running salary helpers ───────────────────────────────────────────────────

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
  // Use IST date so month boundaries align with stored dates (DB datetimes are UTC-shifted)
  const istOffset = 5.5 * 60 * 60 * 1000;
  const today = asOfDate ?? new Date(Date.now() + istOffset).toISOString().slice(0, 10);
  const monthStart = runMonth;
  const [y, m] = runMonth.split("-").map(Number);
  const monthEnd = new Date(y, m, 0).toISOString().slice(0, 10); // last day of month

  // Get employee salary info
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.branch_id, e.process_id,
            esa.ctc_annual,
            esa.structure_id,
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

  // Primary salary source: salary_component_assignments (latest active record)
  // This is the authoritative source for employees assigned directly without a structure.
  const [scaRows] = await db.execute<RowDataPacket[]>(
    `SELECT basic, hra, conveyance, special_allowance, gross
       FROM salary_component_assignments
      WHERE employee_id = ? AND status = 'active'
      ORDER BY effective_date DESC LIMIT 1`,
    [employeeId],
  );
  const scaRow = (scaRows as any[])[0];

  // Fallback: salary_structure_component via structure_id
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

  // Prefer salary_component_assignments when available
  let hasFixedComponents: boolean;
  let fixedBasic: number;
  let fixedHRA: number;
  let fixedGross: number;

  if (scaRow && Number(scaRow.gross) > 0) {
    hasFixedComponents = true;
    fixedBasic = Number(scaRow.basic) || 0;
    fixedHRA   = Number(scaRow.hra)   || 0;
    fixedGross = Number(scaRow.gross);
  } else {
    hasFixedComponents = compAmounts.BASIC !== undefined && compAmounts.BASIC > 0;
    fixedBasic = compAmounts.BASIC || 0;
    fixedHRA   = compAmounts.HRA   || 0;
    fixedGross = hasFixedComponents
      ? (fixedBasic + fixedHRA + (compAmounts.BONUS || 0) + (compAmounts.CONV || 0) +
         (compAmounts.PORTFOLIO || 0) + (compAmounts.MEDICAL || 0) + (compAmounts.LTA || 0) +
         (compAmounts.SPECIAL || 0) + (compAmounts.OTHER_ALLOW || 0) + (compAmounts.PLI || 0))
      : 0;
  }

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
  const esicEmrPct     = statConfig["esic_employer_pct"] ?? 3.25;
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

  // Use fixed component sum as Gross if available, else fall back to CTC/12
  const monthlyGross = hasFixedComponents ? fixedGross : (emp.ctc_annual / 12);

  // Active calendar days (handling mid-month joins/exits)
  const activeCalDays = await _activeCalendarDays(employeeId, runMonth);

  // ── Attendance up to today ────────────────────────────────────────────────
  const tillDate = today < monthEnd ? today : monthEnd;
  const [attRows] = await db.execute<RowDataPacket[]>(
    `SELECT attendance_status, lwp_value, record_date
       FROM attendance_daily_record
      WHERE employee_id = ?
        AND DATE(CONVERT_TZ(record_date, '+00:00', '+05:30')) BETWEEN ? AND ?`,
    [employeeId, monthStart, tillDate],
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
      case "missing_punch":  lwpTillDate += Number(r.lwp_value ?? 1); break;
    }
  }

  const paidWorkingDaysTillDate = presentTillDate + paidLeaveTillDate;

  // Eligible week-offs till date — use the same slab logic as final payroll
  const eligibleWeekoffTillDate = await calculateWeekoffEligibility(
    employeeId,
    paidWorkingDaysTillDate,
    runMonth,
  );

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
    eligibleHolidaysTillDate;
  const cappedEarned = Math.min(Math.max(0, earnedPayableDays), activeCalDays);

  const earnedSalaryTillDate = (monthlyGross / activeCalDays) * cappedEarned;

  // Prorated deductions on earned gross
  const ptEarned = emp.state_code
    ? await getPtFromSlab(emp.state_code, earnedSalaryTillDate)
    : defaultPt;

  // When fixed components are available, calculate basic_pct relative to monthlyGross
  // so that calculateNetSalary derives the correct basic amount
  const effectiveBasicPct = hasFixedComponents
    ? (fixedBasic / monthlyGross) * 100
    : (emp.basic_pct ?? 40);
  const effectiveHraPct = hasFixedComponents
    ? (fixedHRA / monthlyGross) * 100
    : (emp.hra_pct ?? 20);

  const earnedCalc = payrollService.calculateNetSalary({
    grossMonthlyCTC: earnedSalaryTillDate,
    workingDays: Math.max(1, cappedEarned),
    lwpDays: 0, // LWP already baked into cappedEarned
    pfEmployeePct, esicEmployeePct: esicEmpPct, esicEmployerPct: esicEmrPct, esicWageLimit, pfWageLimit,
    professionalTax: ptEarned,
    tds: 0,
    basicPct: effectiveBasicPct,
    hraPct: effectiveHraPct,
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
  // Projected week-offs use same slab logic with projected paid base
  const projectedEligibleWeekoffs = await calculateWeekoffEligibility(
    employeeId,
    projectedPaidWorkingDays,
    runMonth,
  );

  const projectedPayableDaysRaw = presentTillDate + paidLeaveTillDate +
    projectedEligibleWeekoffs + eligibleHolidaysTillDate + futureHolidays +
    futurePresent;
  const projectedPayableDays = Math.min(Math.max(0, projectedPayableDaysRaw), activeCalDays);
  let projectedSalary = (monthlyGross / activeCalDays) * projectedPayableDays;

  // E1.9: Add approved incentives to projected salary
  const [incentiveRows] = await db.execute<RowDataPacket[]>(
    `SELECT SUM(COALESCE(iul.amount, 0)) AS total_incentives
       FROM incentive_upload_line iul
       JOIN incentive_upload_batch ibu ON ibu.id = iul.batch_id
      WHERE iul.employee_id = ?
        AND ibu.pay_month = ?
        AND ibu.status = 'approved'`,
    [employeeId, runMonth.slice(0, 7)]
  );
  const approvedIncentives = Number((incentiveRows[0] as any)?.total_incentives ?? 0);
  projectedSalary += approvedIncentives;

  // Prorated deductions on projected gross
  const ptProjected = emp.state_code
    ? await getPtFromSlab(emp.state_code, projectedSalary)
    : defaultPt;
  const projectedCalc = payrollService.calculateNetSalary({
    grossMonthlyCTC: projectedSalary,
    workingDays: Math.max(1, projectedPayableDays),
    lwpDays: 0,
    pfEmployeePct, esicEmployeePct: esicEmpPct, esicEmployerPct: esicEmrPct, esicWageLimit, pfWageLimit,
    professionalTax: ptProjected,
    tds: 0,
    basicPct: effectiveBasicPct,
    hraPct: effectiveHraPct,
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
