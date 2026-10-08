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

const codes = process.argv.slice(2).filter((a) => /^[A-Za-z0-9]+$/.test(a) && !/^\d{4}-\d{2}$/.test(a)); const code = process.argv.slice(2).find((a) => /^[A-Za-z0-9]+$/.test(a) && !/^\d{4}-\d{2}$/.test(a));
const month = process.argv.slice(2).find((a) => /^\d{4}-\d{2}$/.test(a)) ?? "2026-09";
const q = async (sql: string, p: unknown[]) => {
  if (!/^\s*select/i.test(sql)) throw new Error("read-only");
  const [rows] = await db.execute<RowDataPacket[]>(sql, p as any[]);
  return rows as any[];
};

async function identityBreaks() {
  console.log("active packages whose components do not add up to gross (|diff| > 1):");
  const rows = await q(
    `SELECT e.employee_code, e.date_of_joining, sca.gross,
            (COALESCE(sca.basic,0)+COALESCE(sca.hra,0)+COALESCE(sca.bonus,0)+COALESCE(sca.conveyance,0)+COALESCE(sca.portfolio,0)
             +COALESCE(sca.medical_allowance,0)+COALESCE(sca.lta,0)+COALESCE(sca.special_allowance,0)+COALESCE(sca.other_allowance,0)) AS parts,
            sca.bonus, sca.conveyance, sca.approval_reference
       FROM salary_component_assignments sca JOIN employees e ON e.id = sca.employee_id
      WHERE sca.status = 'active' AND e.active_status = 1
        AND ABS((COALESCE(sca.basic,0)+COALESCE(sca.hra,0)+COALESCE(sca.bonus,0)+COALESCE(sca.conveyance,0)+COALESCE(sca.portfolio,0)
             +COALESCE(sca.medical_allowance,0)+COALESCE(sca.lta,0)+COALESCE(sca.special_allowance,0)+COALESCE(sca.other_allowance,0)) - sca.gross) > 1
      ORDER BY e.date_of_joining DESC LIMIT 60`, []);
  console.log(`count shown (max 60): ${rows.length}`);
  console.table(rows.map((r) => ({ code: r.employee_code, joined: String(r.date_of_joining).slice(0, 10), gross: r.gross, parts: r.parts, bonus: r.bonus, conv: r.conveyance, ref: String(r.approval_reference ?? "").slice(0, 14) })));
}

async function packageContext(empId: string) {
  console.log("sca PF/ESI flags and employer fields:");
  console.table(await q(`SELECT status, pf_applicable, esi_applicable, employer_pf, employer_esi, pf_employee, esic_employee, ctc, net_estimate, package_id FROM salary_component_assignments WHERE employee_id = ?`, [empId]).catch((x) => [{ note: String(x.message).slice(0, 100) }]));
  console.log("salary_package_master for band F (all rows, then rows near this gross):");
  console.table(await q(`SELECT band_code, gross, basic, hra, conveyance, bonus, special_allowance, epf_employee, esic_employee, epf_employer, esic_employer, admin_charges, ctc, net_in_hand FROM salary_package_master WHERE band_code = 'F' LIMIT 10`, []).catch((x) => [{ note: String(x.message).slice(0, 100) }]));
  console.table(await q(`SELECT band_code, gross, basic, hra, conveyance, bonus, epf_employee, esic_employee, admin_charges, ctc, net_in_hand FROM salary_package_master WHERE ABS(gross - 11397.85) < 600 OR ABS(ctc - 13250) < 300 ORDER BY ABS(gross - 11397.85) LIMIT 10`, []).catch((x) => [{ note: String(x.message).slice(0, 100) }]));
}

async function packageMasterReview() {
  const cols = (await q(`SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_package_master'`, [])).map((r) => String(r.c));
  console.log("salary_package_master columns:", cols.join(", "));
  const flag = ["active_status", "is_active", "status"].find((c) => cols.includes(c));
  const act = flag === "status" ? `status IN ('active','ACTIVE')` : flag ? `${flag} = 1` : "1=1";
  console.log(`active filter: ${flag ? act : "none found (all rows)"}`);
  console.log("active packages by band: total / no-PF-no-ESI / with bonus / with admin charges");
  console.table(await q(
    `SELECT band_code, COUNT(*) AS total,
            SUM(epf_employee = 0 AND esic_employee = 0) AS no_pf_esi,
            SUM(bonus > 0) AS with_bonus, SUM(admin_charges > 0) AS with_admin,
            SUM(conveyance > 0) AS with_conv, MIN(gross) AS min_gross, MAX(gross) AS max_gross
       FROM salary_package_master WHERE ${act} GROUP BY band_code ORDER BY band_code`, []));
  console.log("active no-PF/no-ESI packages (distinct gross/ctc) per band:");
  console.table(await q(
    `SELECT band_code, gross, basic, bonus, conveyance, ctc, net_in_hand, COUNT(*) AS n
       FROM salary_package_master WHERE ${act} AND epf_employee = 0 AND esic_employee = 0
      GROUP BY band_code, gross, basic, bonus, conveyance, ctc, net_in_hand ORDER BY band_code, gross LIMIT 40`, []));
  console.log("active packages with ctc or gross within Rs 700 of 13,250 / 11,397.85:");
  console.table(await q(
    `SELECT band_code, gross, basic, bonus, conveyance, epf_employee, esic_employee, admin_charges, ctc, net_in_hand, COUNT(*) AS n
       FROM salary_package_master WHERE ${act} AND (ABS(ctc - 13250) < 700 OR ABS(gross - 11397.85) < 700)
      GROUP BY band_code, gross, basic, bonus, conveyance, epf_employee, esic_employee, admin_charges, ctc, net_in_hand ORDER BY ctc LIMIT 30`, []));
}

async function main() {
  await packageMasterReview();
  await identityBreaks();
  if (!code) throw new Error("pass an employee code");
  const [e] = await q(`SELECT id, date_of_joining, employment_status FROM employees WHERE employee_code = ? LIMIT 1`, [code]);
  if (!e) { console.log(`${code}: not found`); return; }
  console.log(`== ${code} (joined ${String(e.date_of_joining).slice(0, 10)}, ${e.employment_status}), run month ${month}`);

  await packageContext(e.id);
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
