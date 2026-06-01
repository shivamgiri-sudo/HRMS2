import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { payrollService } from "./payroll.service.js";
import type { SalaryPrepRun } from "./payroll.types.js";
import { maternityService } from "../compliance/maternity.service.js";

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
 * Calculate TDS under New Regime (Section 115BAC) FY 2025-26.
 * Applies standard deduction and 87A rebate from statutory_config.
 */
export function calculateTds(
  annualTaxableIncome: number,
  statutoryConfig: StatutoryConfigMap
): TdsResult {
  const stdDeduction = statutoryConfig["tds_standard_deduction"] ?? 75000;
  const rebateLimit  = statutoryConfig["tds_rebate_87a_limit"]   ?? 700000;

  const taxableIncome = Math.max(0, annualTaxableIncome - stdDeduction);

  // New regime slabs FY 2025-26
  const slabs: Array<{ from: number; to: number; rate: number }> = [
    { from: 0,       to: 300000,  rate: (statutoryConfig["tds_slab_0_300000"]        ?? 0)  / 100 },
    { from: 300001,  to: 700000,  rate: (statutoryConfig["tds_slab_300001_700000"]   ?? 5)  / 100 },
    { from: 700001,  to: 1000000, rate: (statutoryConfig["tds_slab_700001_1000000"]  ?? 10) / 100 },
    { from: 1000001, to: 1200000, rate: (statutoryConfig["tds_slab_1000001_1200000"] ?? 15) / 100 },
    { from: 1200001, to: 1500000, rate: (statutoryConfig["tds_slab_1200001_1500000"] ?? 20) / 100 },
    { from: 1500001, to: Infinity, rate: (statutoryConfig["tds_slab_1500001_above"]  ?? 30) / 100 },
  ];

  let tax = 0;
  for (const slab of slabs) {
    if (taxableIncome <= slab.from - 1) break;
    const slabMax = slab.to === Infinity ? taxableIncome : Math.min(taxableIncome, slab.to);
    const slabMin = slab.from - 1;
    tax += (slabMax - slabMin) * slab.rate;
  }

  // Section 87A rebate: nil tax if total income <= rebateLimit
  if (annualTaxableIncome <= rebateLimit) {
    tax = 0;
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
            bm.state_code
       FROM employees e
       JOIN employee_salary_assignment esa ON esa.employee_id = e.id
       JOIN salary_structure_master ss      ON ss.id = esa.structure_id
       LEFT JOIN process_master pm          ON pm.id = e.process_id
       LEFT JOIN branch_master bm           ON bm.id = e.branch_id
      WHERE e.employment_status = 'active' AND ${empConds.join(" AND ")}`,
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
    // 5. Fetch attendance summary for this employee for run_month
    const monthStart = `${run.run_month}-01`;
    const monthEnd   = `${run.run_month}-${String(daysInMonth).padStart(2, "0")}`;

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

    const grossMonthly = emp.ctc_annual / 12;

    // 5a. Fetch tax declaration for this employee / financial year
    const [declRows] = await db.execute<RowDataPacket[]>(
      "SELECT declared_hra, declared_80c, declared_80d, regime FROM tax_declaration WHERE employee_id = ? AND financial_year = ? LIMIT 1",
      [emp.employee_id, financialYear]
    );
    const decl = (declRows as TaxDeclarationRow[])[0] ?? null;

    // 5b. Compute TDS via annual projection
    const annualGross = grossMonthly * 12;
    const declHra  = decl ? Number(decl.declared_hra)  : 0;
    const decl80c  = decl ? Number(decl.declared_80c)  : 0;
    const decl80d  = decl ? Number(decl.declared_80d)  : 0;
    // Standard deduction applied inside calculateTds; additional declaration deductions here
    const taxableIncome = Math.max(0, annualGross - declHra - decl80c - decl80d);
    const tdsResult = calculateTds(taxableIncome, statConfig);
    const tdsMonthly = tdsResult.tds_monthly;

    // 5c. LWP deduction — skip for employees on maternity leave (MBA 1961 s.5(1))
    const workingDays = att.working_days || defaultWorkingDays;
    const lwpDays = att.lwp_days || 0;
    const isOnMaternityLeave = maternityExemptIds.has(emp.employee_id);
    const lwpDeduction = (!isOnMaternityLeave && lwpDays > 0)
      ? Math.round((grossMonthly / workingDays) * lwpDays * 100) / 100
      : 0;
    const grossAfterLwp = Math.max(0, grossMonthly - lwpDeduction);

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

    const calc = payrollService.calculateNetSalary({
      grossMonthlyCTC: grossAfterLwp,
      workingDays,
      lwpDays: 0, // LWP already applied above; pass 0 to avoid double-deduction
      pfEmployeePct: stat.pf_employee_pct,
      esicEmployeePct: stat.esic_employee_pct,
      esicWageLimit: stat.esic_wage_limit,
      pfWageLimit: stat.pf_wage_limit,
      professionalTax,
      tds: tdsMonthly,
      basicPct: emp.basic_pct ?? 40,
      hraPct: emp.hra_pct ?? 20,
    });

    // Net pay = payrollService net + advance recovery deducted on top
    const netPayFinal = Math.max(0, calc.net_salary - advanceRecovery);
    const totalDedFinal = calc.total_deductions + advanceRecovery + lwpDeduction;

    // 6. Upsert prep line
    await db.execute(
      `INSERT INTO salary_prep_line
         (id, run_id, employee_id, employee_code,
          working_days, present_days, leave_days, lwp_days, late_marks, dialer_hours,
          gross_salary, total_deductions, net_salary,
          pf_employee, pf_employer, esic_employee, esic_employer,
          professional_tax, tds, tds_amount, lwp_deduction, advance_recovery, status)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'calculated')
       ON DUPLICATE KEY UPDATE
         working_days = VALUES(working_days), present_days = VALUES(present_days),
         lwp_days = VALUES(lwp_days), gross_salary = VALUES(gross_salary),
         total_deductions = VALUES(total_deductions), net_salary = VALUES(net_salary),
         pf_employee = VALUES(pf_employee), pf_employer = VALUES(pf_employer),
         esic_employee = VALUES(esic_employee), esic_employer = VALUES(esic_employer),
         professional_tax = VALUES(professional_tax),
         tds = VALUES(tds), tds_amount = VALUES(tds_amount),
         lwp_deduction = VALUES(lwp_deduction), advance_recovery = VALUES(advance_recovery),
         status = 'calculated'`,
      [
        runId, emp.employee_id, emp.employee_code,
        att.working_days, att.present_days, att.leave_days, att.lwp_days, att.late_marks, att.dialer_hours,
        calc.gross_salary, totalDedFinal, netPayFinal,
        calc.pf_employee, calc.pf_employer, calc.esic_employee, calc.esic_employer,
        calc.professional_tax, tdsMonthly, tdsMonthly, lwpDeduction, advanceRecovery,
      ]
    );

    totalGross += calc.gross_salary;
    totalDed   += totalDedFinal;
    totalNet   += netPayFinal;
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
