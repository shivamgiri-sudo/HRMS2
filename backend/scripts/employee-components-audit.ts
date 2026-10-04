/**
 * One employee's salary components across HRMS and db_bill. STRICTLY READ-ONLY (SELECT only).
 *
 *   npx tsx scripts/employee-components-audit.ts 63694C [YYYY-MM]
 *
 * Shows: package rows (salary_component_assignments), the stored salary line, its itemised components
 * (type / source / amount), the payslip if any, and db_bill's latest salary_data row (entitlement and earned
 * columns). Employee code only, no PII.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db, closePool } from "../src/db/mysql.js";
import { billQuery, closeBillPool } from "../src/db/billDb.js";

const code = process.argv.slice(2).find((a) => /^[A-Za-z0-9]+$/.test(a) && !/^\d{4}-\d{2}$/.test(a));
const month = process.argv.slice(2).find((a) => /^\d{4}-\d{2}$/.test(a)) ?? "2026-09";
const q = async (sql: string, p: unknown[]) => {
  if (!/^\s*select/i.test(sql)) throw new Error("read-only");
  const [rows] = await db.execute<RowDataPacket[]>(sql, p as any[]);
  return rows as any[];
};

async function main() {
  if (!code) throw new Error("pass an employee code");
  const [e] = await q(`SELECT id, date_of_joining, employment_status FROM employees WHERE employee_code = ? LIMIT 1`, [code]);
  if (!e) { console.log(`${code}: not found`); return; }
  console.log(`== ${code} (joined ${String(e.date_of_joining).slice(0, 10)}, ${e.employment_status}), run month ${month}`);

  console.log("salary_component_assignments:");
  console.table(await q(
    `SELECT status, effective_date, gross, basic, hra, conveyance, bonus, portfolio, medical_allowance, lta, special_allowance, other_allowance, pli, approval_reference
       FROM salary_component_assignments WHERE employee_id = ? ORDER BY created_at`, [e.id]));
  console.log("employee_salary_assignment:");
  console.table(await q(`SELECT active_status, effective_from, ROUND(ctc_annual/12) AS monthly_ctc, structure_id IS NOT NULL AS has_structure FROM employee_salary_assignment WHERE employee_id = ?`, [e.id]));

  const lines = await q(
    `SELECT spl.id, r.run_month, r.status AS run_status, spl.status, spl.gross_salary, spl.total_deductions, spl.net_salary, spl.final_payable_days,
            spl.pf_employer, spl.esic_employer, spl.admin_charges
       FROM salary_prep_line spl JOIN salary_prep_run r ON r.id = spl.run_id
      WHERE spl.employee_id = ? ORDER BY r.run_month DESC LIMIT 3`, [e.id]).catch(async () => await q(
    `SELECT spl.id, r.run_month, r.status AS run_status, spl.status, spl.gross_salary, spl.total_deductions, spl.net_salary, spl.final_payable_days
       FROM salary_prep_line spl JOIN salary_prep_run r ON r.id = spl.run_id
      WHERE spl.employee_id = ? ORDER BY r.run_month DESC LIMIT 3`, [e.id]));
  console.log("latest salary lines:");
  console.table(lines.map(({ id, ...l }) => l));
  for (const l of lines.slice(0, 2)) {
    console.log(`components of ${l.run_month} line:`);
    console.table(await q(
      `SELECT component_code, component_name, component_type, amount, source, taxable FROM salary_prep_line_component WHERE line_id = ? ORDER BY component_type, component_code`, [l.id]));
  }
  const [br] = await q(`SELECT candidate_id FROM ats_onboarding_bridge WHERE employee_id = ? LIMIT 1`, [e.id]).catch(() => []);
  if (!br) console.log("no ATS onboarding bridge row");
  else {
    console.log("ats_payroll_hr_validation:");
    console.table(await q(`SELECT * FROM ats_payroll_hr_validation WHERE candidate_id = ? LIMIT 1`, [br.candidate_id]).catch((x) => [{ note: String(x.message).slice(0, 100) }]));
    console.log("salary_register:");
    console.table(await q(`SELECT * FROM salary_register WHERE candidate_id = ? LIMIT 1`, [br.candidate_id]).catch((x) => [{ note: String(x.message).slice(0, 100) }]));
    console.log("ats_employment_offer:");
    console.table(await q(`SELECT * FROM ats_employment_offer WHERE candidate_id = ? ORDER BY created_at DESC LIMIT 1`, [br.candidate_id]).catch((x) => [{ note: String(x.message).slice(0, 100) }]));
  }
  console.log("db_bill latest salary_data rows:");
  const b = await billQuery<any>(
    `SELECT SalayDate, WorkingDays, EarnedDays, Basic, HRA, Bonus, Conv, Portfolio, MedicalAllowance, SpecialAllowance, OtherAllowance, Gross,
            Basic1, HRA1, Bonus1, Conv1, Portfolio1, MedicalAllowance1, SpecialAllowance1, OtherAllowance1, Gross1, EPF, ESIC, EPFCompany, ESICCompany, AdminChrg, NetSalary
       FROM salary_data WHERE TRIM(EmpCode) = ? ORDER BY SalayDate DESC LIMIT 2`, [code]);
  console.table(b.map((r) => ({ ...r, SalayDate: String(r.SalayDate).slice(0, 10) })));
}

main().then(async () => { await closeBillPool(); await closePool(); })
  .catch(async (e) => { console.error("ERR", e?.message ?? e); try { await closeBillPool(); await closePool(); } catch { } process.exit(1); });
