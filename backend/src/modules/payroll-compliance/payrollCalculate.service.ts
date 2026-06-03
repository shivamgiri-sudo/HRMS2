import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { payrollService } from "./payroll.service.js";
import type { SalaryPrepRun } from "./payroll.types.js";
import { maternityService } from "../compliance/maternity.service.js";
import { taxEngineService } from "./taxEngine.service.js";
import { payrollComplianceService, type ComponentLine } from "./payrollCompliance.service.js";

interface TaxDeclarationRow {
  declared_hra: number;
  declared_80c: number;
  declared_80d: number;
  regime: string;
}

const LOCKED_STATUSES = new Set(["locked", "disbursed"]);
const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export interface GratuityResult {
  eligible: boolean;
  amount: number;
  years: number;
}

export async function calculateGratuity(employeeId: string, lastBasicMonthly: number): Promise<GratuityResult> {
  const [rows] = await db.execute<RowDataPacket[]>("SELECT date_of_joining FROM employees WHERE id = ? LIMIT 1", [employeeId]);
  const emp = (rows as Array<{ date_of_joining: string }>)[0];
  if (!emp?.date_of_joining) return { eligible: false, amount: 0, years: 0 };
  const joinDate = new Date(emp.date_of_joining);
  const today = new Date();
  const diffMs = today.getTime() - joinDate.getTime();
  const totalMonths = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 30.4375));
  const completedYears = Math.floor(totalMonths / 12);
  if (totalMonths < 60) return { eligible: false, amount: 0, years: completedYears };
  return { eligible: true, amount: r2((lastBasicMonthly / 26) * 15 * completedYears), years: completedYears };
}

// Backward-compatible export for old callers.
export function calculateTds(annualTaxableIncome: number, statutoryConfig: Record<string, number>) {
  const stdDeduction = statutoryConfig["tds_standard_deduction"] ?? 75000;
  const taxableIncome = Math.max(0, annualTaxableIncome - stdDeduction);
  const slabs = [
    { from: 0, to: 400000, rate: 0 },
    { from: 400000, to: 800000, rate: 0.05 },
    { from: 800000, to: 1200000, rate: 0.10 },
    { from: 1200000, to: 1600000, rate: 0.15 },
    { from: 1600000, to: 2000000, rate: 0.20 },
    { from: 2000000, to: 2400000, rate: 0.25 },
    { from: 2400000, to: Infinity, rate: 0.30 },
  ];
  let tax = 0;
  for (const s of slabs) {
    if (taxableIncome <= s.from) continue;
    tax += (Math.min(taxableIncome, s.to) - s.from) * s.rate;
  }
  if (taxableIncome <= 1200000) tax = 0;
  const tds_annual = r2(tax * 1.04);
  return { tds_annual, tds_monthly: r2(tds_annual / 12), effective_rate: annualTaxableIncome > 0 ? r2((tds_annual / annualTaxableIncome) * 100) : 0 };
}

export async function getPtFromSlab(stateCode: string, monthlyIncome: number): Promise<number> {
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
  if (!row) throw new Error(`Professional Tax slab missing for state ${stateCode} and income ${monthlyIncome}`);
  return Number(row.pt_amount);
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

function financialYearFromRunMonth(runMonth: string): string {
  const [year, month] = runMonth.split("-").map(Number);
  const fyStartYear = month >= 4 ? year : year - 1;
  return `${fyStartYear}-${String(fyStartYear + 1).slice(2)}`;
}

function calculateMonthsRemaining(runMonth: string): number {
  const [, month] = runMonth.split("-").map(Number);
  const fyMonthIndex = month >= 4 ? month - 3 : month + 9;
  return Math.max(1, 13 - fyMonthIndex);
}

function componentAmount(components: ComponentLine[], code: string): number {
  return components.filter(c => c.component_code === code).reduce((s, c) => s + Number(c.amount || 0), 0);
}

export async function calculatePayrollRun(runId: string, userId: string): Promise<CalculateResult> {
  const [runRows] = await db.execute<RowDataPacket[]>("SELECT * FROM salary_prep_run WHERE id = ? LIMIT 1", [runId]);
  const run = (runRows as SalaryPrepRun[])[0] as any;
  if (!run) throw new Error("Run not found");
  if (LOCKED_STATUSES.has(run.status)) throw new Error(`Cannot recalculate a ${run.status} run`);

  const financialYear = run.financial_year || financialYearFromRunMonth(run.run_month);
  const monthsRemaining = calculateMonthsRemaining(run.run_month);

  const compliance = await payrollComplianceService.validateRun(runId);
  if (compliance.issues_count > 0) {
    await payrollComplianceService.logAudit(runId, null, "PAYROLL_COMPLIANCE_BLOCKED", compliance, userId);
    throw new Error(`Payroll compliance check failed with ${compliance.issues_count} issue(s). Resolve/waive issues before calculation.`);
  }

  const [statKvRows] = await db.execute<RowDataPacket[]>("SELECT config_key, config_value FROM statutory_config");
  const statConfig: Record<string, number> = {};
  for (const r of statKvRows as Array<{ config_key: string; config_value: number }>) statConfig[r.config_key.toLowerCase()] = Number(r.config_value);
  const stat: StatutoryRow = {
    pf_employee_pct: statConfig["pf_employee_pct"] ?? 12,
    esic_employee_pct: statConfig["esic_employee_pct"] ?? 0.75,
    esic_wage_limit: statConfig["esic_wage_limit"] ?? 21000,
    pf_wage_limit: statConfig["pf_wage_limit"] ?? 15000,
    professional_tax: statConfig["professional_tax"] ?? 0,
  };

  const empConds: string[] = ["esa.active_status = 1", "LOWER(e.employment_status) = 'active'", "e.active_status = 1"];
  const empParams: unknown[] = [];
  if (run.process_id) { empConds.push("e.process_id = ?"); empParams.push(run.process_id); }
  else if (run.process_filter) { empConds.push("(pm.process_name = ? OR e.process_id IN (SELECT id FROM process_master WHERE process_name = ?))"); empParams.push(run.process_filter, run.process_filter); }
  if (run.branch_id) { empConds.push("e.branch_id = ?"); empParams.push(run.branch_id); }
  else if (run.branch_filter) { empConds.push("e.branch_id IN (SELECT id FROM branch_master WHERE branch_name = ?)"); empParams.push(run.branch_filter); }

  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id AS employee_id, e.employee_code,
            esa.ctc_annual, ss.basic_pct, ss.hra_pct,
            bm.state_code
       FROM employees e
       JOIN employee_salary_assignment esa ON esa.employee_id = e.id
       JOIN salary_structure_master ss ON ss.id = esa.structure_id
       LEFT JOIN process_master pm ON pm.id = e.process_id
       LEFT JOIN branch_master bm ON bm.id = e.branch_id
      WHERE ${empConds.join(" AND ")}
      ORDER BY e.employee_code`,
    empParams
  );
  const employees = empRows as EmployeeRow[];

  const [year, month] = run.run_month.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const defaultWorkingDays = 26;
  const maternityExemptIds = await maternityService.getActiveEmployeeIdsForMonth(run.run_month);

  let totalGross = 0, totalDed = 0, totalNet = 0;

  for (const emp of employees) {
    const monthStart = `${run.run_month}-01`;
    const monthEnd = `${run.run_month}-${String(daysInMonth).padStart(2, "0")}`;

    const [adrCountRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM attendance_daily_record WHERE employee_id = ? AND record_date BETWEEN ? AND ?`,
      [emp.employee_id, monthStart, monthEnd]
    );
    const hasEngineData = Number((adrCountRows[0] as any).cnt ?? 0) > 0;

    let att: AttendanceRow;
    if (hasEngineData) {
      const [attRows] = await db.execute<RowDataPacket[]>(
        `SELECT
           ? AS employee_id,
           (SELECT COUNT(*) FROM attendance_daily_record
             WHERE employee_id = ? AND record_date BETWEEN ? AND ?
               AND attendance_status NOT IN ('week_off','holiday')) AS working_days,
           COUNT(CASE WHEN adr.attendance_status = 'present' THEN 1 END) AS present_days,
           COUNT(CASE WHEN adr.attendance_status IN ('leave_approved','half_day') THEN 1 END) AS leave_days,
           COALESCE(SUM(adr.lwp_value), 0) AS lwp_days,
           COALESCE(SUM(adr.late_mark), 0) AS late_marks,
           COALESCE(SUM(CASE WHEN adr.attendance_source = 'dialler' THEN adr.raw_minutes / 60.0 END), NULL) AS dialer_hours
         FROM attendance_daily_record adr
         WHERE adr.employee_id = ? AND adr.record_date BETWEEN ? AND ?`,
        [emp.employee_id, emp.employee_id, monthStart, monthEnd, emp.employee_id, monthStart, monthEnd]
      );
      att = (attRows as AttendanceRow[])[0] ?? { employee_id: emp.employee_id, working_days: defaultWorkingDays, present_days: defaultWorkingDays, leave_days: 0, lwp_days: 0, late_marks: 0, dialer_hours: null };
    } else {
      const [attRows] = await db.execute<RowDataPacket[]>(
        `SELECT
           ? AS employee_id,
           ? AS working_days,
           COUNT(DISTINCT CASE WHEN s.current_status IN ('Logged Out','Logged In') THEN s.session_date END) AS present_days,
           0 AS leave_days,
           GREATEST(? - COUNT(DISTINCT CASE WHEN s.current_status IN ('Logged Out','Logged In') THEN s.session_date END), 0) AS lwp_days,
           0 AS late_marks,
           NULL AS dialer_hours
         FROM wfm_attendance_session s
         WHERE s.employee_id = ? AND s.session_date BETWEEN ? AND ?`,
        [emp.employee_id, defaultWorkingDays, defaultWorkingDays, emp.employee_id, monthStart, monthEnd]
      );
      att = (attRows as AttendanceRow[])[0] ?? { employee_id: emp.employee_id, working_days: defaultWorkingDays, present_days: defaultWorkingDays, leave_days: 0, lwp_days: 0, late_marks: 0, dialer_hours: null };
    }

    const workingDays = Number(att.working_days || defaultWorkingDays);
    const grossMonthly = r2(Number(emp.ctc_annual) / 12);
    const isOnMaternityLeave = maternityExemptIds.has(emp.employee_id);
    const lwpDays = isOnMaternityLeave ? 0 : Number(att.lwp_days || 0);

    const baseComponents = await payrollComplianceService.getComponentBreakup(emp.employee_id, run.run_month, grossMonthly, Number(emp.basic_pct ?? 40), Number(emp.hra_pct ?? 20));
    const grossBeforeLwp = r2(baseComponents.filter(c => c.component_type === "earning").reduce((s, c) => s + c.amount, 0));
    const earnedComponents = payrollComplianceService.applyLwpToEarnings(baseComponents, workingDays, lwpDays);
    const grossAfterLwp = r2(earnedComponents.filter(c => c.component_type === "earning").reduce((s, c) => s + c.amount, 0));
    const lwpDeduction = r2(Math.max(0, grossBeforeLwp - grossAfterLwp));

    const basic = componentAmount(earnedComponents, "BASIC") || r2(grossAfterLwp * (Number(emp.basic_pct ?? 40) / 100));
    const hra = componentAmount(earnedComponents, "HRA") || r2(grossAfterLwp * (Number(emp.hra_pct ?? 20) / 100));
    const special = componentAmount(earnedComponents, "SPECIAL") || r2(grossAfterLwp - basic - hra);

    const [declRows] = await db.execute<RowDataPacket[]>(
      "SELECT declared_hra, declared_80c, declared_80d, regime FROM tax_declaration WHERE employee_id = ? AND financial_year = ? LIMIT 1",
      [emp.employee_id, financialYear]
    );
    const decl = (declRows as TaxDeclarationRow[])[0] ?? null;
    const tdsResult = await taxEngineService.calculateMonthlyTds({ financialYear, annualGross: grossBeforeLwp * 12, declaration: decl, alreadyDeducted: 0, monthsRemaining });
    const tdsMonthly = tdsResult.tds_monthly;

    const [advRows] = await db.execute<RowDataPacket[]>(
      `SELECT COALESCE(SUM(ROUND(amount / recovery_months, 2)), 0) AS monthly_recovery FROM salary_advance_log WHERE employee_id = ? AND status = 'active'`,
      [emp.employee_id]
    );
    const advanceRecovery = Number((advRows as Array<{ monthly_recovery: number }>)[0]?.monthly_recovery ?? 0);
    const professionalTax = emp.state_code ? await getPtFromSlab(emp.state_code, grossAfterLwp) : stat.professional_tax;

    const [adjRows] = await db.execute<RowDataPacket[]>(
      `SELECT COALESCE(SUM(CASE WHEN adjustment_type='earning' THEN amount ELSE 0 END),0) AS earning_adj,
              COALESCE(SUM(CASE WHEN adjustment_type IN ('deduction','statutory_override') THEN amount ELSE 0 END),0) AS deduction_adj
         FROM salary_prep_line_adjustment WHERE run_id = ? AND employee_id = ? AND approval_status = 'approved'`,
      [runId, emp.employee_id]
    );
    const earningAdj = Number((adjRows[0] as any)?.earning_adj ?? 0);
    const deductionAdj = Number((adjRows[0] as any)?.deduction_adj ?? 0);

    const calc = payrollService.calculateNetSalary({
      grossMonthlyCTC: r2(grossAfterLwp + earningAdj),
      workingDays,
      lwpDays: 0,
      pfEmployeePct: stat.pf_employee_pct,
      esicEmployeePct: stat.esic_employee_pct,
      esicWageLimit: stat.esic_wage_limit,
      pfWageLimit: stat.pf_wage_limit,
      professionalTax,
      tds: tdsMonthly,
      basicPct: emp.basic_pct ?? 40,
      hraPct: emp.hra_pct ?? 20,
    });

    const netPayFinal = r2(Math.max(0, calc.net_salary - advanceRecovery - deductionAdj));
    const totalDedFinal = r2(calc.total_deductions + advanceRecovery + lwpDeduction + deductionAdj);
    const manualAdjustmentTotal = r2(earningAdj - deductionAdj);
    const employerStatCost = r2(calc.pf_employer + calc.esic_employer + calc.gratuity);

    await db.execute(
      `INSERT INTO salary_prep_line
         (id, run_id, employee_id, employee_code,
          working_days, present_days, leave_days, lwp_days, late_marks, dialer_hours,
          gross_salary, total_deductions, net_salary,
          pf_employee, pf_employer, esic_employee, esic_employer,
          professional_tax, tds, tds_amount, lwp_deduction, advance_recovery, status,
          gross_before_lwp, basic, hra, special_allowance, employer_statutory_cost,
          manual_adjustment_total, calculation_status, calculation_version, calculation_notes)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'calculated',
               ?, ?, ?, ?, ?, ?, 'system_calculated', 'INDIA_COMPLIANCE_V1', ?)
       ON DUPLICATE KEY UPDATE
         working_days = VALUES(working_days), present_days = VALUES(present_days),
         leave_days = VALUES(leave_days), lwp_days = VALUES(lwp_days),
         late_marks = VALUES(late_marks), dialer_hours = VALUES(dialer_hours),
         gross_salary = VALUES(gross_salary),
         total_deductions = VALUES(total_deductions), net_salary = VALUES(net_salary),
         pf_employee = VALUES(pf_employee), pf_employer = VALUES(pf_employer),
         esic_employee = VALUES(esic_employee), esic_employer = VALUES(esic_employer),
         professional_tax = VALUES(professional_tax),
         tds = VALUES(tds), tds_amount = VALUES(tds_amount),
         lwp_deduction = VALUES(lwp_deduction), advance_recovery = VALUES(advance_recovery),
         status = 'calculated',
         gross_before_lwp = VALUES(gross_before_lwp),
         basic = VALUES(basic), hra = VALUES(hra), special_allowance = VALUES(special_allowance),
         employer_statutory_cost = VALUES(employer_statutory_cost),
         manual_adjustment_total = VALUES(manual_adjustment_total),
         calculation_status = VALUES(calculation_status),
         calculation_version = VALUES(calculation_version),
         calculation_notes = VALUES(calculation_notes)`,
      [
        runId, emp.employee_id, emp.employee_code,
        workingDays, att.present_days, att.leave_days, att.lwp_days, att.late_marks, att.dialer_hours,
        calc.gross_salary, totalDedFinal, netPayFinal,
        calc.pf_employee, calc.pf_employer, calc.esic_employee, calc.esic_employer,
        calc.professional_tax, tdsMonthly, tdsMonthly, lwpDeduction, advanceRecovery,
        grossBeforeLwp, basic, hra, special, employerStatCost, manualAdjustmentTotal,
        JSON.stringify({ tax: tdsResult, maternity_lwp_exempt: isOnMaternityLeave, source: baseComponents.some(c => c.source === "snapshot") ? "component_snapshot" : "salary_structure" }),
      ]
    );

    const [lineRows] = await db.execute<RowDataPacket[]>("SELECT id FROM salary_prep_line WHERE run_id = ? AND employee_id = ? LIMIT 1", [runId, emp.employee_id]);
    const lineId = (lineRows[0] as any)?.id ?? null;
    const statutoryComponents: ComponentLine[] = [
      { component_code: "PF_EMPLOYEE", component_name: "Employee PF", component_type: "deduction", amount: calc.pf_employee, source: "statutory", taxable: false },
      { component_code: "ESIC_EMPLOYEE", component_name: "Employee ESIC", component_type: "deduction", amount: calc.esic_employee, source: "statutory", taxable: false },
      { component_code: "PROF_TAX", component_name: "Professional Tax", component_type: "deduction", amount: calc.professional_tax, source: "statutory", taxable: false },
      { component_code: "TDS", component_name: "Tax Deducted at Source", component_type: "deduction", amount: tdsMonthly, source: "statutory", taxable: false },
      { component_code: "PF_EMPLOYER", component_name: "Employer PF", component_type: "employer_cost", amount: calc.pf_employer, source: "statutory", taxable: false },
      { component_code: "ESIC_EMPLOYER", component_name: "Employer ESIC", component_type: "employer_cost", amount: calc.esic_employer, source: "statutory", taxable: false },
      { component_code: "GRATUITY_PROVISION", component_name: "Gratuity Provision", component_type: "employer_cost", amount: calc.gratuity, source: "statutory", taxable: false },
    ];
    await payrollComplianceService.replaceLineComponents(runId, lineId, emp.employee_id, [...earnedComponents, ...statutoryComponents]);
    await payrollComplianceService.logAudit(runId, emp.employee_id, "PAYROLL_LINE_CALCULATED", { gross_before_lwp: grossBeforeLwp, gross_after_lwp: calc.gross_salary, total_deductions: totalDedFinal, net_salary: netPayFinal, tds: tdsResult }, userId);

    totalGross += Number(calc.gross_salary);
    totalDed += totalDedFinal;
    totalNet += netPayFinal;
  }

  await db.execute(
    `UPDATE salary_prep_run
        SET status = 'calculated',
            total_employees = ?,
            total_gross = ?,
            total_deductions = ?,
            total_net = ?,
            financial_year = ?,
            payroll_model_version = 'INDIA_COMPLIANCE_V1'
      WHERE id = ?`,
    [employees.length, r2(totalGross), r2(totalDed), r2(totalNet), financialYear, runId]
  );

  const [updated] = await db.execute<RowDataPacket[]>("SELECT * FROM salary_prep_run WHERE id = ? LIMIT 1", [runId]);
  return { run_id: runId, status: (updated as SalaryPrepRun[])[0]?.status ?? "calculated", employees_processed: employees.length, total_gross: r2(totalGross), total_deductions: r2(totalDed), total_net: r2(totalNet) };
}
