import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2/promise";
import { resolveHolidaysForEmployeeV2 } from "./holiday-work.service.js";
import { payrollService } from "./payroll.service.js";
import { calculateWeekoffEligibility } from "./weekoff-eligibility.service.js";
import { loadFlatStatutoryConfig } from "./statutory-config.loader.js";

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
  lwp_till_date: number;
  earned_salary_till_date: number;
  earned_net_till_date: number;
  projected_payable_days: number;
  projected_salary: number;
  projected_net: number;
  pf_employee: number;
  esic_employee: number;
  professional_tax: number;
  esic_applicable: boolean;
  gross_monthly: number;
  // ── APR provenance (display only — see the split below) ────────────────────
  apr_eligible: boolean;
  apr_verified_payable_days: number | null;
  apr_verified_salary_till_date: number | null;
  fallback_payable_days: number | null;
  fallback_salary_till_date: number | null;
  apr_no_data_days: number | null;
}> {
  // Use IST date so month boundaries align with stored dates (DB datetimes are UTC-shifted)
  const istOffset = 5.5 * 60 * 60 * 1000;
  const today = asOfDate ?? new Date(Date.now() + istOffset).toISOString().slice(0, 10);
  const monthStart = runMonth;
  const [y, m] = runMonth.split("-").map(Number);
  // `new Date(y, m, 0)` is a LOCAL instant; .toISOString() serialises it as UTC. On any host
  // east of UTC — IST included, which is what this project runs on — that subtracts the
  // offset and lands on the PREVIOUS day, so July resolved to 2026-07-30 while daysInMonth
  // below said 31. The month's last day was dropped from every figure derived from it:
  // `tillDate` (capped earned days on the final day of the month), the remaining-days count
  // and the future-holiday window. Built from the date string instead — the same idiom this
  // file already uses for the other monthEnd in computeEffectiveDays — so it is exact in
  // every timezone. daysInMonth is unaffected: it constructs AND reads locally.
  const daysInMonth = new Date(y, m, 0).getDate();
  const monthEnd = `${runMonth.slice(0, 7)}-${String(daysInMonth).padStart(2, "0")}`;

  // Get employee salary info
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.branch_id, e.process_id,
            e.designation_id, e.department_id,
            dm.designation_name, dp.dept_name,
            esa.ctc_annual,
            esa.structure_id,
            ss.basic_pct, ss.hra_pct,
            bm.state AS state_code
       FROM employees e
       JOIN employee_salary_assignment esa ON esa.employee_id = e.id AND esa.active_status = 1
       JOIN salary_structure_master ss     ON ss.id = esa.structure_id
       LEFT JOIN branch_master bm          ON bm.id = e.branch_id
       LEFT JOIN designation_master dm     ON dm.id = e.designation_id
       LEFT JOIN department_master dp      ON dp.id = e.department_id
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

  // Statutory config for deductions, in force for the month being shown — a
  // rate dated next quarter must not change what this month's running salary
  // reads as earned so far.
  const statConfig = await loadFlatStatutoryConfig(runMonth);
  const pfEmployeePct  = statConfig["pf_employee_pct"]   ?? 12;
  const esicEmpPct     = statConfig["esic_employee_pct"] ?? 0.75;
  const esicEmrPct     = statConfig["esic_employer_pct"] ?? 3.25;
  const esicWageLimit  = statConfig["esic_wage_limit"]   ?? 21000;
  const pfWageLimit    = statConfig["pf_wage_limit"]     ?? 15000;
  // No fallback to 200. PT is a state levy with no org-wide default — the same
  // policy the locked payroll run enforces. An employee with no branch state
  // gets 0 here (no deduction shown in running salary) rather than a number
  // nobody approved. statutory_config has never held this key in production.
  const defaultPt      = statConfig["professional_tax"]  ?? 0;

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
    `SELECT attendance_status, lwp_value, record_date, attendance_source, source_system
       FROM attendance_daily_record
      WHERE employee_id = ?
        AND DATE(CONVERT_TZ(record_date, '+00:00', '+05:30')) BETWEEN ? AND ?`,
    [employeeId, monthStart, tillDate],
  );

  let presentTillDate = 0;
  let paidLeaveTillDate = 0;
  let lwpTillDate = 0;
  let weekoffRosteredTillDate = 0;

  // Where each paid day's evidence came from.
  //
  // An APR-eligible employee is meant to be judged on dialler net login, but
  // attendance-engine.service.ts:809-828 falls back to the biometric punch on any
  // day APR has nothing for — otherwise the ~626 of 829 Operations Executives who
  // are absent from the dialler feed would be marked absent, lwp 1.00, every day.
  // That fallback is correct for pay and invisible on screen, which is what these
  // counters exist to fix. They change no arithmetic.
  let fallbackPaidDays = 0;   // paid day value with no positive APR evidence behind it
  let aprNoDataDays = 0;      // neither source had anything (missing_punch)

  for (const r of attRows as any[]) {
    const sourceSystem = String(r.source_system ?? "");
    // Paid day value this row contributes, mirroring the switch below.
    const paidValue =
      r.attendance_status === "present" || r.attendance_status === "late" ? 1
        : r.attendance_status === "half_day" ? 0.5
          : 0;
    // Verified means POSITIVE APR evidence, not merely "labelled dialler".
    //
    // `attendance_source` alone cannot answer this. The engine stamps a day
    // 'dialler' with source_system 'dialer_session_log.session_date' to record
    // where it LOOKED, not what it found — and dialer_session_log holds 739 rows
    // all-time, every one with a NULL employee_id, so it has never yielded a
    // minute for anybody. 4,329 such days across 1,020 employees would otherwise
    // be reported as APR-verified on the strength of a lookup that found nothing.
    //
    // So the test is the source_system prefix: apr.ReportDate,
    // apr.night_shift_window, apr_bulk and apr_regularization all carry real APR
    // minutes; apr_no_activity is the explicit "APR had nothing" marker.
    //
    // leave_approved never reaches here — paidValue is 0 for it — so an HR-approved
    // absence is not counted as unverified.
    const aprEvidenced = sourceSystem.startsWith("apr") && sourceSystem !== "apr_no_activity";
    if (paidValue > 0 && !aprEvidenced) fallbackPaidDays += paidValue;
    if (sourceSystem === "apr_no_activity") aprNoDataDays += 1;

    switch (r.attendance_status) {
      case "present":        presentTillDate += 1; break;
      case "late":           presentTillDate += 1; break;
      case "half_day":       presentTillDate += 0.5; lwpTillDate += 0.5; break;
      case "leave_approved": paidLeaveTillDate += 1; break;
      case "week_off":       weekoffRosteredTillDate += 1; break;
      case "absent":         lwpTillDate += 1; break;
      case "missing_punch":  lwpTillDate += Number(r.lwp_value ?? 1); break;
    }
  }

  const paidWorkingDaysTillDate = presentTillDate + paidLeaveTillDate;

  // Resolved before the week-off calls below, which need the month's holiday count: the
  // eligibility test measures paid base against (days - weekoffs - holidays), so a projection
  // that passed 0 here would show fewer week-offs than the locked run will actually grant.
  // The FULL-month count is the right input even mid-month, because availableWorkingDays is
  // itself a full-month figure — the final engine compares against the same denominator.
  const runMonthYM = `${y}-${String(m).padStart(2, "0")}`;
  const { eligibleHolidayDates } = await resolveHolidaysForEmployeeV2(employeeId, runMonthYM);
  const eligibleHolidayCountMonth = eligibleHolidayDates.length;

  // Eligible week-offs till date — use the same slab logic as final payroll
  const eligibleWeekoffTillDate = await calculateWeekoffEligibility(
    employeeId,
    paidWorkingDaysTillDate,
    runMonth,
    eligibleHolidayCountMonth,
  );

  // Eligible holidays till date.
  //
  // Previously looped day-by-day calling resolveHolidaysForEmployee(employeeId, d)
  // with a full date string where resolveHolidaysForEmployeeV2 expects "YYYY-MM" —
  // it built dateFrom = "2026-08-15-01", which never matches a real holiday_date
  // (confirmed live: the correct query found 1 August 2026 holiday, the malformed
  // one found 0, silently, no error). Net effect: this function never counted a
  // holiday for any employee, ever. Fixed by resolving the month's eligible holiday
  // dates once, correctly, and filtering by date range instead of re-querying per day.
  const eligibleHolidaysTillDate = eligibleHolidayDates.filter(
    (d) => d >= monthStart && d <= tillDate
  ).length;

  const earnedPayableDays = presentTillDate + paidLeaveTillDate + eligibleWeekoffTillDate +
    eligibleHolidaysTillDate;
  const cappedEarned = Math.min(Math.max(0, earnedPayableDays), activeCalDays);

  let earnedSalaryTillDate = (monthlyGross / daysInMonth) * cappedEarned;

  // E1.9: Add approved incentives to earned salary (same as projected path below).
  // Incentives are a month-level lump sum approved before payroll runs — they are
  // earned as of approval, not spread across days, so they belong in the earned
  // figure as soon as they are approved.
  const [incentiveRowsEarned] = await db.execute<RowDataPacket[]>(
    `SELECT SUM(COALESCE(iul.amount, 0)) AS total_incentives
       FROM incentive_upload_line iul
       JOIN incentive_upload_batch ibu ON ibu.id = iul.batch_id
      WHERE iul.employee_id = ?
        AND ibu.pay_month = ?
        AND ibu.status = 'approved'`,
    [employeeId, runMonth.slice(0, 7)],
  );
  const approvedIncentivesEarned = Number((incentiveRowsEarned[0] as any)?.total_incentives ?? 0);
  earnedSalaryTillDate += approvedIncentivesEarned;

  // Advance recovery — same query as payrollCalculate.service.ts step 5d
  let advanceRecoveryEarned = 0;
  try {
    const [advRows] = await db.execute<RowDataPacket[]>(
      `SELECT COALESCE(SUM(ROUND(amount / recovery_months, 2)), 0) AS monthly_recovery
         FROM salary_advance_log
        WHERE employee_id = ? AND status = 'active'`,
      [employeeId],
    );
    advanceRecoveryEarned = Number((advRows[0] as any)?.monthly_recovery ?? 0);
  } catch { /* table may not exist in all environments */ }

  // Loan EMI recovery
  let loanEmiEarned = 0;
  try {
    const monthStartStr = runMonth.slice(0, 7) + "-01";
    const [loanRows] = await db.execute<RowDataPacket[]>(
      `SELECT COALESCE(SUM(deduction_per_month), 0) AS loan_emi
         FROM employee_loans
        WHERE employee_id = ? AND status = 'active'
          AND start_date <= ? AND (end_date IS NULL OR end_date >= ?)`,
      [employeeId, monthStartStr, monthStartStr],
    );
    loanEmiEarned = Number((loanRows[0] as any)?.loan_emi ?? 0);
  } catch { /* employee_loans may not exist */ }

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

  const earnedCalcRaw = payrollService.calculateNetSalary({
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
  // Mirror the payroll-calculate deduction pass: subtract advance recovery and loan EMI
  const earnedCalc = {
    ...earnedCalcRaw,
    net_salary: Math.max(0, earnedCalcRaw.net_salary - advanceRecoveryEarned - loanEmiEarned),
  };

  // ── Projection ────────────────────────────────────────────────────────────
  // Count remaining calendar days from tomorrow to month-end.
  // No roster dependency — week-off eligibility is purely slab-based on paidBase count.
  let futurePresent = 0;
  {
    const cursor = new Date(today);
    cursor.setDate(cursor.getDate() + 1);
    const end = new Date(monthEnd);
    while (cursor <= end) {
      futurePresent += 1;
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  // Future holidays — same fix as the till-date count above, reusing the one
  // correctly-resolved eligibleHolidayDates list instead of re-querying per day.
  const tomorrowD = new Date(today);
  tomorrowD.setDate(tomorrowD.getDate() + 1);
  const tomorrowStr = tomorrowD.toISOString().slice(0, 10);
  const futureHolidays = eligibleHolidayDates.filter(
    (d) => d >= tomorrowStr && d <= monthEnd
  ).length;

  // Week-off eligibility for the projection uses the EARNED paid base only.
  // Adding futurePresent (all remaining calendar days incl. Sundays) to paidWorkingDaysTillDate
  // inflates a working-day count with calendar days — different units — pushing the sum past
  // availableWorkingDays and triggering the "full attendance → all week-offs" path even when
  // the employee has only 25.5 of the 26 needed working days (Aug 2026, 5-Sunday month).
  // The final payroll engine uses actual full-month attendance; the projection should show what
  // the employee has earned so far, not a speculative future that hasn't happened.
  const projectedEligibleWeekoffs = await calculateWeekoffEligibility(
    employeeId,
    paidWorkingDaysTillDate,
    runMonth,
    eligibleHolidayCountMonth,
  );

  const projectedPayableDaysRaw = presentTillDate + paidLeaveTillDate +
    projectedEligibleWeekoffs + eligibleHolidaysTillDate + futureHolidays +
    futurePresent;
  const projectedPayableDays = Math.min(Math.max(0, projectedPayableDaysRaw), activeCalDays);
  let projectedSalary = (monthlyGross / daysInMonth) * projectedPayableDays;

  // E1.9: Add approved incentives to projected salary (same value already fetched above for earned)
  projectedSalary += approvedIncentivesEarned;

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

  // ── APR provenance split ──────────────────────────────────────────────────
  //
  // Display only. The verified figure is the existing total MINUS the fallback
  // share, never a second formula, so the two always add back to exactly what
  // payroll will pay. Week-off and holiday entitlement and approved incentives
  // stay on the verified side: none of them is a reading off the dialler feed.
  //
  // Resolved through the engine's own isAprEligible rather than a fresh regex.
  // Three Operations-Executive tests already exist in this codebase and they
  // disagree with each other; a fourth would be the worst of both.
  let aprEligible = false;
  try {
    const { attendanceEngineService } = await import("../wfm/attendance-engine.service.js");
    aprEligible = await attendanceEngineService.isAprEligible(
      emp.designation_id ?? null,
      emp.department_id ?? null,
      emp.process_id ?? null,
      String(emp.dept_name ?? "").toLowerCase(),
      String(emp.designation_name ?? "").toLowerCase(),
    );
  } catch {
    // Provenance is a label on the number, not the number. If eligibility cannot
    // be resolved, report no APR context rather than failing the salary read.
    aprEligible = false;
  }

  const fallbackSalaryTillDate = aprEligible
    ? (monthlyGross / daysInMonth) * fallbackPaidDays
    : 0;

  return {
    earned_payable_days: cappedEarned,
    eligible_weekoff_till_date: eligibleWeekoffTillDate,
    eligible_holiday_till_date: eligibleHolidaysTillDate,
    lwp_till_date: Math.round(lwpTillDate * 10) / 10,
    earned_salary_till_date: Math.round(earnedSalaryTillDate * 100) / 100,
    earned_net_till_date: Math.round(earnedCalc.net_salary * 100) / 100,
    projected_payable_days: projectedPayableDays,
    projected_salary: Math.round(projectedSalary * 100) / 100,
    projected_net: Math.round(projectedCalc.net_salary * 100) / 100,
    pf_employee: Math.round(earnedCalc.pf_employee * 100) / 100,
    esic_employee: Math.round(earnedCalc.esic_employee * 100) / 100,
    professional_tax: Math.round(earnedCalc.professional_tax * 100) / 100,
    esic_applicable: !esicOptOut && monthlyGross <= esicWageLimit,
    gross_monthly: Math.round(monthlyGross * 100) / 100,
    apr_eligible: aprEligible,
    apr_verified_payable_days: aprEligible
      ? Math.round(Math.max(0, cappedEarned - fallbackPaidDays) * 10) / 10
      : null,
    apr_verified_salary_till_date: aprEligible
      ? Math.round(Math.max(0, earnedSalaryTillDate - fallbackSalaryTillDate) * 100) / 100
      : null,
    fallback_payable_days: aprEligible ? Math.round(fallbackPaidDays * 10) / 10 : null,
    fallback_salary_till_date: aprEligible
      ? Math.round(fallbackSalaryTillDate * 100) / 100
      : null,
    apr_no_data_days: aprEligible ? aprNoDataDays : null,
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
    lwp_till_date: 0,
    earned_salary_till_date: 0,
    earned_net_till_date: 0,
    projected_payable_days: 0,
    projected_salary: 0,
    projected_net: 0,
    pf_employee: 0,
    esic_employee: 0,
    professional_tax: 0,
    esic_applicable: false as boolean,
    gross_monthly: 0,
    apr_eligible: false,
    apr_verified_payable_days: null as number | null,
    apr_verified_salary_till_date: null as number | null,
    fallback_payable_days: null as number | null,
    fallback_salary_till_date: null as number | null,
    apr_no_data_days: null as number | null,
  };
}
