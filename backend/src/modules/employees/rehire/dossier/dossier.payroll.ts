import type { RowDataPacket } from "mysql2";
import { num, numOrNull, round1, type DossierWindow, type SqlExecutor } from "./dossierTypes.js";

export interface PayrollSection {
  payslips: { month: string; gross: number; net: number; deductions: number }[];
  lastNet: number | null;
  avgNet: number | null;
  currentSalary: { gross: number | null; ctc: number | null } | null;
  /** null when a recovery table could not be read; the page shows "unavailable", not zero. */
  pendingRecoveries: { loans: number; advances: number; deductions: number; total: number } | null;
}

// Only final runs, same visibility rule as dashboards/role-insights/providers/employeeCalc.ts. Drafts are not pay.
const SLIP_SQL = `
  SELECT spr.run_month AS run_month, spl.gross_salary AS gross_salary, spl.net_salary AS net_salary,
         spl.total_deductions AS total_deductions
    FROM salary_prep_line spl
    JOIN salary_prep_run spr ON spr.id = spl.run_id
   WHERE spl.employee_id = ?
     AND LOWER(spr.status) IN ('locked', 'finalized', 'approved', 'disbursed', 'completed')
     AND LOWER(COALESCE(spl.status, '')) NOT IN ('excluded', 'blocked')
   ORDER BY spr.run_month DESC
   LIMIT 12`;
const SALARY_SQL = `SELECT gross, ctc FROM employee_salary_history WHERE employee_id = ? AND is_current = 1 LIMIT 1`;
const LOAN_SQL = `SELECT COALESCE(SUM(pending_amount), 0) AS total FROM employee_loans WHERE employee_id = ? AND status = 'active'`;
const ADVANCE_SQL = `SELECT COALESCE(SUM(amount - COALESCE(recovered_amount, 0)), 0) AS total FROM salary_advance_log WHERE employee_id = ? AND amount - COALESCE(recovered_amount, 0) > 0`;
const DEDUCTION_SQL = `SELECT COALESCE(SUM(amount), 0) AS total FROM employee_deduction_entries WHERE employee_id = ? AND status IN ('active', 'pending_approval')`;

export async function loadPayrollSection(db: SqlExecutor, w: DossierWindow): Promise<PayrollSection> {
  const [slipRows] = await db.execute<RowDataPacket[]>(SLIP_SQL, [w.employeeId]);
  const payslips = slipRows.map((r) => ({
    month: String(r.run_month),
    gross: num(r.gross_salary),
    net: num(r.net_salary),
    deductions: num(r.total_deductions),
  }));

  let currentSalary: PayrollSection["currentSalary"] = null;
  try {
    const [rows] = await db.execute<RowDataPacket[]>(SALARY_SQL, [w.employeeId]);
    if (rows[0]) currentSalary = { gross: numOrNull(rows[0].gross), ctc: numOrNull(rows[0].ctc) };
  } catch {
    currentSalary = null;
  }

  // Three independent tables, read as one unit: a wrong column in any of them means "unavailable", not a partial total.
  let pendingRecoveries: PayrollSection["pendingRecoveries"] = null;
  try {
    const [loan] = await db.execute<RowDataPacket[]>(LOAN_SQL, [w.employeeId]);
    const [adv] = await db.execute<RowDataPacket[]>(ADVANCE_SQL, [w.employeeId]);
    const [ded] = await db.execute<RowDataPacket[]>(DEDUCTION_SQL, [w.employeeId]);
    const loans = num(loan[0]?.total);
    const advances = num(adv[0]?.total);
    const deductions = num(ded[0]?.total);
    pendingRecoveries = { loans, advances, deductions, total: loans + advances + deductions };
  } catch {
    pendingRecoveries = null;
  }

  return {
    payslips,
    lastNet: payslips[0]?.net ?? null,
    avgNet: payslips.length ? round1(payslips.reduce((a, p) => a + p.net, 0) / payslips.length) : null,
    currentSalary,
    pendingRecoveries,
  };
}
