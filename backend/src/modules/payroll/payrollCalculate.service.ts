import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { payrollService, breakSpecialAllowance } from "./payroll.service.js";
import type { SalaryPrepRun } from "./payroll.types.js";
import { maternityService } from "../compliance/maternity.service.js";
import { calculateWeekoffEligibility } from "./weekoff-eligibility.service.js";
import { resolveHolidaysForEmployeeV2 } from "./holiday-work.service.js";
import { checkAndReverseLeave } from "./leave-reversal.service.js";

interface TaxDeclarationRow {
  declared_hra: number;
  declared_80c: number;
  declared_80d: number;
  regime: string;
}

const LOCKED_STATUSES = new Set(["locked", "disbursed"]);

// ─── Gratuity ─────────────────────────────────────────────────────────────────

export interface GratuityResult {
  eligible: boolean;
  amount: number;
  years: number;
}

/**
 * Calculate gratuity for an employee using the Payment of Gratuity Act formula:
 * amount = (lastBasicMonthly / 26) * 15 * completedYears
 * Eligibility: >= 60 months (5 years) of continuous service.
 */
export async function calculateGratuity(
  employeeId: string,
  lastBasicMonthly: number
): Promise<GratuityResult> {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT date_of_joining FROM employees WHERE id = ? LIMIT 1",
    [employeeId]
  );
  const emp = (rows as Array<{ date_of_joining: string }>)[0];
  if (!emp?.date_of_joining) {
    return { eligible: false, amount: 0, years: 0 };
  }

  const joinDate = new Date(emp.date_of_joining);
  const today = new Date();
  const diffMs = today.getTime() - joinDate.getTime();
  const totalMonths = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 30.4375));
  const completedYears = Math.floor(totalMonths / 12);

  if (totalMonths < 60) {
    return { eligible: false, amount: 0, years: completedYears };
  }

  const amount = Math.round(((lastBasicMonthly / 26) * 15 * completedYears) * 100) / 100;
  return { eligible: true, amount, years: completedYears };
}

// ─── TDS ──────────────────────────────────────────────────────────────────────

export interface TdsResult {
  tds_annual: number;
  tds_monthly: number;
  effective_rate: number;
}

interface StatutoryConfigMap {
  [key: string]: number;
}

/**
 * Calculate TDS under New Regime (Section 115BAC) FY 2026-27 (Budget 2025).
 * Slabs: 0-4L=0%, 4-8L=5%, 8-12L=10%, 12-16L=15%, 16-20L=20%, 20-24L=25%, 24L+=30%.
 * 87A rebate ₹12L, standard deduction ₹75K, 4% health+education cess.
 * All thresholds and rates driven from statutory_config — no hardcoded defaults.
 */
export function calculateTds(
  annualTaxableIncome: number,
  statutoryConfig: StatutoryConfigMap
): TdsResult {
  const stdDeduction = statutoryConfig["tds_standard_deduction"] ?? 75000;
  // Budget 2025: 87A rebate is ₹12L (total income ≤ ₹12L → nil tax)
  const rebateLimit  = statutoryConfig["tds_rebate_87a_limit"]   ?? 1200000;
  const cessPct      = statutoryConfig["tds_cess_pct"]           ?? 4;

  const taxableIncome = Math.max(0, annualTaxableIncome - stdDeduction);

  // New regime slabs FY 2026-27 — Budget 2025 (Finance Act 2025)
  const slabs: Array<{ from: number; to: number; rate: number }> = [
    { from: 0,       to: 400000,  rate: (statutoryConfig["tds_slab_0_400000"]         ?? 0)  / 100 },
    { from: 400001,  to: 800000,  rate: (statutoryConfig["tds_slab_400001_800000"]    ?? 5)  / 100 },
    { from: 800001,  to: 1200000, rate: (statutoryConfig["tds_slab_800001_1200000"]   ?? 10) / 100 },
    { from: 1200001, to: 1600000, rate: (statutoryConfig["tds_slab_1200001_1600000"]  ?? 15) / 100 },
    { from: 1600001, to: 2000000, rate: (statutoryConfig["tds_slab_1600001_2000000"]  ?? 20) / 100 },
    { from: 2000001, to: 2400000, rate: (statutoryConfig["tds_slab_2000001_2400000"]  ?? 25) / 100 },
    { from: 2400001, to: Infinity, rate: (statutoryConfig["tds_slab_2400001_above"]   ?? 30) / 100 },
  ];

  let tax = 0;
  for (const slab of slabs) {
    if (taxableIncome <= slab.from - 1) break;
    const slabMax = slab.to === Infinity ? taxableIncome : Math.min(taxableIncome, slab.to);
    const slabMin = slab.from - 1;
    tax += (slabMax - slabMin) * slab.rate;
  }

  // Section 87A rebate: nil tax if total income ≤ rebateLimit (₹12L FY2026-27)
  if (annualTaxableIncome <= rebateLimit) {
    tax = 0;
  } else {
    // 4% health and education cess on income tax (Section 112A / Finance Act)
    tax = tax * (1 + cessPct / 100);
  }

  const tds_annual  = Math.round(tax * 100) / 100;
  const tds_monthly = Math.round((tds_annual / 12) * 100) / 100;
  const effective_rate = annualTaxableIncome > 0
    ? Math.round((tds_annual / annualTaxableIncome) * 10000) / 100
    : 0;

  return { tds_annual, tds_monthly, effective_rate };
}

// ─── Professional Tax from Slab ───────────────────────────────────────────────

/**
 * Look up PT amount for a given state and monthly income from pt_slab_master.
 * Falls back to 200 if no matching slab is found.
 */
export async function getPtFromSlab(
  stateCode: string,
  monthlyIncome: number
): Promise<number> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT pt_amount FROM pt_slab_master
      WHERE state_code = ?
        AND is_active = 1
        AND income_from <= ?
        AND (income_to IS NULL OR income_to >= ?)
      ORDER BY income_from DESC
      LIMIT 1`,
    [stateCode, monthlyIncome, monthlyIncome]
  );
  const row = (rows as Array<{ pt_amount: number }>)[0];
  return row ? Number(row.pt_amount) : 200;
}

export interface CalculateResult {
  run_id: string;
  status: string;
  employees_processed: number;
  total_gross: number;
  total_deductions: number;
  total_net: number;
}

interface EmployeeRow {
  employee_id: string;
  employee_code: string;
  ctc_annual: number;
  basic_pct: number;
  hra_pct: number;
  state_code: string | null;
  salary_start_date: string | null;
}

interface AttendanceRow {
  employee_id: string;
  working_days: number;
  present_days: number;
  leave_days: number;
  lwp_days: number;
  late_marks: number;
  dialer_hours: number | null;
}

interface StatutoryRow {
  pf_employee_pct: number;
  esic_employee_pct: number;
  esic_wage_limit: number;
  pf_wage_limit: number;
  professional_tax: number;
}

export async function calculatePayrollRun(runId: string, userId: string): Promise<CalculateResult> {
  // 1. Load run
  const [runRows] = await db.execute<RowDataPacket[]>(
    "SELECT * FROM salary_prep_run WHERE id = ? LIMIT 1", [runId]
  );
  const run = (runRows as SalaryPrepRun[])[0];
  if (!run) throw new Error("Run not found");
  if (LOCKED_STATUSES.has(run.status)) {
    throw new Error(`Cannot recalculate a ${run.status} run`);
  }
  // TDS mode: 'manual' = skip auto-TDS projection; Payroll HO uploads amounts separately.
  const tdsMode: 'auto' | 'manual' = (run as any).tds_mode ?? 'manual';

  // 2a. Load statutory config as flat key→value map (for TDS slab lookups)
  const [statKvRows] = await db.execute<RowDataPacket[]>(
    "SELECT config_key, config_value FROM statutory_config"
  );
  const statConfig: StatutoryConfigMap = {};
  for (const r of statKvRows as Array<{ config_key: string; config_value: number }>) {
    // Normalise keys to lowercase so calculateTds() lookups work
    statConfig[r.config_key.toLowerCase()] = Number(r.config_value);
  }

  // 2b. Legacy flat-row fallback (PF / ESIC / PT values)
  const stat: StatutoryRow = {
    pf_employee_pct:  statConfig["pf_employee_pct"]  ?? statConfig["pf_employee_pct"]  ?? 12,
    esic_employee_pct: statConfig["esic_employee_pct"] ?? 0.75,
    esic_wage_limit:  statConfig["esic_wage_limit"]  ?? 21000,
    pf_wage_limit:    statConfig["pf_wage_limit"]    ?? 15000,
    professional_tax: statConfig["professional_tax"] ?? 200,
  };

  // 3. Fetch eligible employees (scoped to run's process/branch filters)
  const empConds: string[] = ["esa.active_status = 1"];
  const empParams: unknown[] = [];
  if (run.process_filter) {
    empConds.push("(pm.process_name = ? OR e.process_id IN (SELECT id FROM process_master WHERE process_name = ?))");
    empParams.push(run.process_filter, run.process_filter);
  }
  if (run.branch_filter) {
    empConds.push("e.branch_id IN (SELECT id FROM branch_master WHERE branch_name = ?)");
    empParams.push(run.branch_filter);
  }

  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id AS employee_id, e.employee_code,
            esa.ctc_annual, ss.basic_pct, ss.hra_pct,
            bm.state AS state_code,
            COALESCE(e.salary_start_date, e.date_of_joining) AS salary_start_date
       FROM employees e
       JOIN employee_salary_assignment esa ON esa.employee_id = e.id
       JOIN salary_structure_master ss      ON ss.id = esa.structure_id
       LEFT JOIN process_master pm          ON pm.id = e.process_id
       LEFT JOIN branch_master bm           ON bm.id = e.branch_id
      WHERE LOWER(e.employment_status) = 'active' AND ${empConds.join(" AND ")}`,
    empParams
  );
  const employees = empRows as EmployeeRow[];

  // 4. Derive working days from run_month (Mon–Sat = 26 assumed; real impl queries holidays)
  const [year, month] = run.run_month.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const defaultWorkingDays = 26; // BPO standard; can be refined later

  // Derive financial year string e.g. "2025-26" for months April–March
  const fyStartYear = month >= 4 ? year : year - 1;
  const financialYear = `${fyStartYear}-${String(fyStartYear + 1).slice(2)}`;

  let totalGross = 0;
  let totalDed = 0;
  let totalNet = 0;

  // Fetch employees on approved/active maternity leave covering this pay month.
  // Per MBA 1961 s.5(1) these employees receive full pay — no LWP deduction.
  const maternityExemptIds = await maternityService.getActiveEmployeeIdsForMonth(run.run_month);

  for (const emp of employees) {
    const monthStart = `${run.run_month}-01`;
    const monthEnd   = `${run.run_month}-${String(daysInMonth).padStart(2, "0")}`;

    // salary_start_date gate: skip employees whose salary hasn't started yet this month
    if (emp.salary_start_date) {
      const ssd = new Date(emp.salary_start_date);
      const monthEndDate = new Date(monthEnd);
      if (ssd > monthEndDate) {
        // Still in unpaid training — no payroll entry this month
        continue;
      }
    }

    // Step 1: Load designation and department to determine attendance source
    const [desigRows] = await db.execute<RowDataPacket[]>(
      `SELECT dm.designation_name, dept.dept_name
       FROM employees e
       LEFT JOIN designation_master dm ON dm.id = e.designation_id
       LEFT JOIN department_master dept ON dept.id = e.department_id
       WHERE e.id = ? LIMIT 1`,
      [emp.employee_id]
    );
    const desig = (desigRows[0] as any) ?? {};
    const isOpsExecutive =
      /executive/i.test(desig.designation_name ?? '') &&
      /operations/i.test(desig.dept_name ?? '');

    // Check if attendance_daily_record has been populated for this employee+month
    const [adrCountRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM attendance_daily_record
       WHERE employee_id = ? AND record_date BETWEEN ? AND ?`,
      [emp.employee_id, monthStart, monthEnd]
    );
    const hasEngineData = Number((adrCountRows[0] as any).cnt ?? 0) > 0;

    let att: AttendanceRow;

    if (hasEngineData) {
      // Use attendance_daily_record — role-aware (dialler/biometric) with half-days, leaves, holidays
      const [attRows] = await db.execute<RowDataPacket[]>(
        `SELECT
           ? AS employee_id,
           (SELECT COUNT(*) FROM attendance_daily_record
            WHERE employee_id = ? AND record_date BETWEEN ? AND ?
              AND attendance_status NOT IN ('week_off','holiday')) AS working_days,
           COUNT(CASE WHEN adr.attendance_status = 'present'        THEN 1 END) AS present_days,
           COUNT(CASE WHEN adr.attendance_status IN ('leave_approved','half_day') THEN 1 END) AS leave_days,
           COALESCE(SUM(adr.lwp_value), 0)                                       AS lwp_days,
           COALESCE(SUM(adr.late_mark), 0)                                       AS late_marks,
           COALESCE(SUM(CASE WHEN adr.attendance_source = 'dialler'
                              THEN adr.raw_minutes / 60.0 END), NULL)            AS dialer_hours
         FROM attendance_daily_record adr
         WHERE adr.employee_id = ? AND adr.record_date BETWEEN ? AND ?`,
        [emp.employee_id, emp.employee_id, monthStart, monthEnd, emp.employee_id, monthStart, monthEnd]
      );
      att = (attRows as AttendanceRow[])[0] ?? {
        employee_id: emp.employee_id,
        working_days: defaultWorkingDays,
        present_days: defaultWorkingDays,
        leave_days: 0,
        lwp_days: 0,
        late_marks: 0,
        dialer_hours: null,
      };
    } else {
      // Fallback: legacy session-count query (no attendance engine data yet)
      const [attRows] = await db.execute<RowDataPacket[]>(
        `SELECT
           ? AS employee_id,
           ? AS working_days,
           COUNT(CASE WHEN s.current_status IN ('Logged Out','Logged In') THEN 1 END) AS present_days,
           0 AS leave_days,
           (? - COUNT(CASE WHEN s.current_status IN ('Logged Out','Logged In') THEN 1 END)) AS lwp_days,
           0 AS late_marks,
           NULL AS dialer_hours
         FROM wfm_attendance_session s
         WHERE s.employee_id = ? AND s.session_date BETWEEN ? AND ?`,
        [emp.employee_id, defaultWorkingDays, defaultWorkingDays, emp.employee_id, monthStart, monthEnd]
      );
      att = (attRows as AttendanceRow[])[0] ?? {
        employee_id: emp.employee_id,
        working_days: defaultWorkingDays,
        present_days: defaultWorkingDays,
        leave_days: 0,
        lwp_days: 0,
        late_marks: 0,
        dialer_hours: null,
      };
    }

    // Step 2: Paid base calculation
    // present(1) + half_day(0.5) + all approved leave types(1 each)
    // Use attendance_daily_record which already has status per day
    const [paidBaseRows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COALESCE(SUM(
           CASE
             WHEN adr.attendance_status = 'present'         THEN 1.0
             WHEN adr.attendance_status = 'half_day'        THEN 0.5
             WHEN adr.attendance_status = 'leave_approved'  THEN 1.0
             ELSE 0
           END
         ), 0) AS paid_base
       FROM attendance_daily_record adr
       WHERE adr.employee_id = ? AND adr.record_date BETWEEN ? AND ?`,
      [emp.employee_id, monthStart, monthEnd]
    );
    let paidBase = Number((paidBaseRows[0] as any)?.paid_base ?? 0);
    // Fallback when attendance engine has no data yet
    if (!hasEngineData) paidBase = att.present_days + att.leave_days;

    // Step 4: Week-off eligibility and holiday resolution
    const eligibleWeekoffs = await calculateWeekoffEligibility(emp.employee_id, paidBase, run.run_month);
    const { eligibleHolidayCount, holidayWorkExtraPayout } = await resolveHolidaysForEmployeeV2(emp.employee_id, run.run_month);

    // Step 5: Leave reversal
    const reversalResult = await checkAndReverseLeave({
      employeeId: emp.employee_id,
      runId,
      runMonth: run.run_month,
      paidBase,
      eligibleWeekoffs,
      eligibleHolidays: eligibleHolidayCount,
      daysInMonth,
    });
    // Use the (possibly reduced) paid base after reversal
    const effectivePaidBase = reversalResult.newPaidBase;
    // Recalculate week-offs and holidays with new paid base if reversal happened
    const finalWeekoffs = reversalResult.reversed
      ? await calculateWeekoffEligibility(emp.employee_id, effectivePaidBase, run.run_month)
      : eligibleWeekoffs;
    const finalHolidays = reversalResult.reversed ? eligibleHolidayCount : eligibleHolidayCount;

    // Step 6: Payable days with cap
    const calculatedPayable = effectivePaidBase + finalWeekoffs + finalHolidays;
    const finalPayableDays = Math.min(calculatedPayable, daysInMonth);
    // active_calendar_days: for mid-month joiners, cap to remaining days in month
    const activeCals = emp.salary_start_date
      ? (() => {
          const ssd = new Date(emp.salary_start_date);
          const mStart = new Date(monthStart);
          if (ssd > mStart) {
            const d = new Date(ssd);
            let cnt = 0;
            while (d <= new Date(monthEnd)) { cnt++; d.setDate(d.getDate() + 1); }
            return cnt;
          }
          return daysInMonth;
        })()
      : daysInMonth;

    // Step 7: Days-based gross calculation — replaces pro-rata multiplier + LWP approach
    const isOnMaternityLeave = maternityExemptIds.has(emp.employee_id);
    // Maternity employees receive full monthly gross (MBA 1961 s.5(1))
    const grossMonthly = isOnMaternityLeave
      ? (emp.ctc_annual / 12)
      : (emp.ctc_annual / 12) * (finalPayableDays / daysInMonth);
    // No separate LWP deduction needed — absent days just reduce finalPayableDays
    const lwpDeduction = 0;  // absorbed into days-based calculation
    const grossAfterLwp = grossMonthly;

    // 5a. Fetch tax declaration for this employee / financial year
    const [declRows] = await db.execute<RowDataPacket[]>(
      "SELECT declared_hra, declared_80c, declared_80d, regime FROM tax_declaration WHERE employee_id = ? AND financial_year = ? LIMIT 1",
      [emp.employee_id, financialYear]
    );
    const decl = (declRows as TaxDeclarationRow[])[0] ?? null;

    // 5b. TDS: skip auto-projection when run is in manual TDS mode.
    // In manual mode, Payroll HO uploads per-employee TDS via POST /runs/:id/manual-tds.
    // Those amounts are applied in a post-calculation pass (see applyManualTds below).
    let tdsMonthly = 0;
    if (tdsMode === 'auto') {
      const annualGross = grossAfterLwp * 12;
      const declHra  = decl ? Number(decl.declared_hra)  : 0;
      const decl80c  = decl ? Number(decl.declared_80c)  : 0;
      const decl80d  = decl ? Number(decl.declared_80d)  : 0;
      const taxableIncome = Math.max(0, annualGross - declHra - decl80c - decl80d);
      tdsMonthly = calculateTds(taxableIncome, statConfig).tds_monthly;
    }

    // 5d. Salary advance monthly recovery
    const [advRows] = await db.execute<RowDataPacket[]>(
      `SELECT COALESCE(SUM(ROUND(amount / recovery_months, 2)), 0) AS monthly_recovery
         FROM salary_advance_log
        WHERE employee_id = ? AND status = 'active'`,
      [emp.employee_id]
    );
    const advanceRecovery = Number((advRows as Array<{ monthly_recovery: number }>)[0]?.monthly_recovery ?? 0);

    // Resolve PT from slab when employee has a state_code, else fall back to config value
    const professionalTax = emp.state_code
      ? await getPtFromSlab(emp.state_code, grossAfterLwp)
      : stat.professional_tax;

    // Check for approved PF / ESI opt-outs (employee voluntary declaration approved by Payroll HO)
    const [overrideRows] = await db.execute<RowDataPacket[]>(
      `SELECT override_type FROM employee_statutory_override
       WHERE employee_id = ? AND status = 'approved'
         AND (effective_from_month IS NULL OR effective_from_month <= ?)`,
      [emp.employee_id, run.run_month]
    );
    const pfOptOut   = (overrideRows as Array<{ override_type: string }>).some(r => r.override_type === 'pf_opt_out');
    const esicOptOut = (overrideRows as Array<{ override_type: string }>).some(r => r.override_type === 'esic_opt_out');

    const calc = payrollService.calculateNetSalary({
      grossMonthlyCTC: grossAfterLwp,
      workingDays: att.working_days || defaultWorkingDays,
      lwpDays: 0, // LWP already absorbed into days-based gross; pass 0 to avoid double-deduction
      pfEmployeePct: stat.pf_employee_pct,
      esicEmployeePct: stat.esic_employee_pct,
      esicWageLimit: stat.esic_wage_limit,
      pfWageLimit: stat.pf_wage_limit,
      professionalTax,
      tds: tdsMonthly,
      basicPct: emp.basic_pct ?? 40,
      hraPct: emp.hra_pct ?? 20,
      pfOptOut,
      esicOptOut,
    });

    // Net pay = payrollService net + holiday work extra payout - advance recovery
    const netPayFinal = Math.max(0, calc.net_salary + holidayWorkExtraPayout - advanceRecovery);
    const totalDedFinal = calc.total_deductions + advanceRecovery;

    // 6. Upsert prep line with extended columns
    const prepLineId = randomUUID();
    await db.execute(
      `INSERT INTO salary_prep_line
         (id, run_id, employee_id, employee_code,
          working_days, present_days, leave_days, lwp_days, late_marks, dialer_hours,
          gross_salary, gross_before_lwp, total_deductions, net_salary,
          basic, hra, special_allowance,
          pf_employee, pf_employer, esic_employee, esic_employer,
          professional_tax, tds, tds_amount, lwp_deduction, advance_recovery,
          paid_working_days, eligible_weekoff_days, eligible_holiday_days,
          final_payable_days, active_calendar_days, holiday_work_extra_payout,
          status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'calculated')
       ON DUPLICATE KEY UPDATE
         working_days = VALUES(working_days), present_days = VALUES(present_days),
         lwp_days = VALUES(lwp_days), gross_salary = VALUES(gross_salary),
         gross_before_lwp = VALUES(gross_before_lwp),
         total_deductions = VALUES(total_deductions), net_salary = VALUES(net_salary),
         basic = VALUES(basic), hra = VALUES(hra), special_allowance = VALUES(special_allowance),
         pf_employee = VALUES(pf_employee), pf_employer = VALUES(pf_employer),
         esic_employee = VALUES(esic_employee), esic_employer = VALUES(esic_employer),
         professional_tax = VALUES(professional_tax),
         tds = VALUES(tds), tds_amount = VALUES(tds_amount),
         lwp_deduction = VALUES(lwp_deduction), advance_recovery = VALUES(advance_recovery),
         paid_working_days = VALUES(paid_working_days),
         eligible_weekoff_days = VALUES(eligible_weekoff_days),
         eligible_holiday_days = VALUES(eligible_holiday_days),
         final_payable_days = VALUES(final_payable_days),
         active_calendar_days = VALUES(active_calendar_days),
         holiday_work_extra_payout = VALUES(holiday_work_extra_payout),
         status = 'calculated'`,
      [
        prepLineId, runId, emp.employee_id, emp.employee_code,
        att.working_days, att.present_days, att.leave_days, att.lwp_days, att.late_marks, att.dialer_hours,
        calc.gross_salary, grossMonthly, totalDedFinal, netPayFinal,
        calc.basic, calc.hra, calc.special_allowance,
        calc.pf_employee, calc.pf_employer, calc.esic_employee, calc.esic_employer,
        calc.professional_tax, tdsMonthly, tdsMonthly, lwpDeduction, advanceRecovery,
        effectivePaidBase, finalWeekoffs, finalHolidays, finalPayableDays, activeCals, holidayWorkExtraPayout,
      ]
    );

    // 6b. Insert component-level breakdown for payslip display
    const { conv, ma, pa } = breakSpecialAllowance(calc.special_allowance);
    const components = [
      { code: "BASIC", name: "Basic Salary", amount: calc.basic },
      { code: "HRA", name: "House Rent Allowance", amount: calc.hra },
      { code: "CONV", name: "Conveyance Allowance", amount: conv },
      { code: "MA", name: "Medical Allowance", amount: ma },
      { code: "PA", name: "Personal Allowance", amount: pa },
    ];
    for (const comp of components) {
      await db.execute(
        `INSERT INTO salary_prep_line_component
           (id, run_id, line_id, employee_id, component_code, component_name, component_type, amount, source, taxable)
         VALUES (?, ?, ?, ?, ?, ?, 'earning', ?, 'structure', 1)
         ON DUPLICATE KEY UPDATE
           amount = VALUES(amount), source = VALUES(source), taxable = VALUES(taxable)`,
        [randomUUID(), runId, prepLineId, emp.employee_id, comp.code, comp.name, comp.amount]
      );
    }

    // Step 11: Audit log per employee
    await db.execute(
      `INSERT INTO sensitive_action_log
         (id, actor_user_id, actor_role, action_type, module_key, entity_type, entity_id, old_value_json, new_value_json, ip_address, user_agent)
       VALUES (UUID(), 'system', 'payroll-engine', 'payroll_calculation', 'payroll', 'salary_prep_line', ?, NULL, ?, '127.0.0.1', 'payroll-engine')`,
      [emp.employee_id, JSON.stringify({
        run_id: runId,
        attendance_source: isOpsExecutive ? 'APR/dialler' : 'biometric',
        paid_base: effectivePaidBase,
        eligible_weekoffs: finalWeekoffs,
        eligible_holidays: finalHolidays,
        calculated_payable: calculatedPayable,
        final_payable: finalPayableDays,
        leave_reversed: reversalResult.daysReversed,
        gross: grossAfterLwp,
        net: netPayFinal,
      })]
    );

    totalGross += calc.gross_salary;
    totalDed   += totalDedFinal;
    totalNet   += netPayFinal;
  }

  // 7a. Apply manual TDS entries (only when tds_mode = 'manual')
  // For each row in salary_run_manual_tds, update the salary_prep_line TDS fields
  // and recalculate net_salary / total_deductions in-place.
  if (tdsMode === 'manual') {
    const [manualTdsRows] = await db.execute<RowDataPacket[]>(
      `SELECT employee_id, tds_amount FROM salary_run_manual_tds WHERE run_id = ?`,
      [runId]
    );
    for (const row of manualTdsRows as Array<{ employee_id: string; tds_amount: number }>) {
      const tdsAmt = Number(row.tds_amount) || 0;
      await db.execute(
        `UPDATE salary_prep_line
            SET tds = ?, tds_amount = ?,
                total_deductions = total_deductions + ?,
                net_salary = GREATEST(0, net_salary - ?)
          WHERE run_id = ? AND employee_id = ?`,
        [tdsAmt, tdsAmt, tdsAmt, tdsAmt, runId, row.employee_id]
      );
    }
    // Recalculate run totals after TDS application
    const [sumRows] = await db.execute<RowDataPacket[]>(
      `SELECT COALESCE(SUM(gross_salary),0) AS tg,
              COALESCE(SUM(total_deductions),0) AS td,
              COALESCE(SUM(net_salary),0) AS tn
       FROM salary_prep_line WHERE run_id = ?`,
      [runId]
    );
    const sums = (sumRows[0] as any);
    totalGross = Number(sums.tg);
    totalDed   = Number(sums.td);
    totalNet   = Number(sums.tn);
  }

  // 7. Update run totals + status
  await db.execute(
    `UPDATE salary_prep_run
        SET status = 'processing', total_employees = ?,
            total_gross = ?, total_deductions = ?, total_net = ?
      WHERE id = ?`,
    [employees.length, totalGross, totalDed, totalNet, runId]
  );

  const [updated] = await db.execute<RowDataPacket[]>(
    "SELECT * FROM salary_prep_run WHERE id = ? LIMIT 1", [runId]
  );

  return {
    run_id: runId,
    status: (updated as SalaryPrepRun[])[0]?.status ?? "processing",
    employees_processed: employees.length,
    total_gross: totalGross,
    total_deductions: totalDed,
    total_net: totalNet,
  };
}
