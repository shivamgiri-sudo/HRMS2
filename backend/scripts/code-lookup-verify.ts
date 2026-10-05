/**
 * STRICTLY READ-ONLY. One employee code in HRMS and db_bill: record, status, dates, org, other codes sharing the same
 * PAN/Aadhaar (codes only), attendance and salary summaries. No identifier values are printed.
 *   npx tsx scripts/code-lookup-verify.ts MAS63449
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { billQuery, closeBillPool } from "../src/db/billDb.js";

const CODE = (process.argv[2] ?? "").trim().toUpperCase();
const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0];
const d10 = (v: unknown) => (v ? (v instanceof Date ? v.toLocaleDateString("en-CA") : String(v).slice(0, 10)) : null);
const l4 = (v: unknown) => String(v ?? "").replace(/\D/g, "").slice(-4) || null;
const norm = (v: unknown) => String(v ?? "").trim().toUpperCase();

async function main() {
  if (!/^[A-Z0-9-]{3,20}$/.test(CODE)) throw new Error("give one employee code");
  console.log(`== ${CODE} ==`);
  const h = await q(
    `SELECT e.id, e.employee_code, e.biometric_code, e.first_name, e.last_name, e.date_of_birth, e.date_of_joining, e.date_of_exit,
            e.date_of_leaving, e.active_status, e.employment_status, e.created_at, RIGHT(e.mobile,4) m4, e.pan_number, e.aadhaar_last4,
            (SELECT branch_name FROM branch_master WHERE id=e.branch_id) branch,
            (SELECT cost_centre_name FROM cost_centre_master WHERE id=e.cost_centre_id) cc,
            (SELECT designation_name FROM designation_master WHERE id=e.designation_id) designation
       FROM employees e WHERE UPPER(TRIM(e.employee_code)) = ?`, [CODE]);
  console.log("HRMS rows:", h.length);
  for (const r of h) {
    const { id, pan_number, aadhaar_last4, ...rest } = r;
    console.log(" ", JSON.stringify({ ...rest, date_of_birth: d10(r.date_of_birth), date_of_joining: d10(r.date_of_joining), date_of_exit: d10(r.date_of_exit), date_of_leaving: d10(r.date_of_leaving), created_at: d10(r.created_at) }));
    const att = await q(`SELECT attendance_status s, COUNT(*) n, MIN(record_date) f, MAX(record_date) l FROM attendance_daily_record WHERE employee_id = ? AND record_date >= '2026-08-01' GROUP BY s`, [id]);
    console.log("  HRMS attendance since 1 Aug:", JSON.stringify(att.map((a) => ({ ...a, f: d10(a.f), l: d10(a.l) }))));
    const pay = await q(`SELECT s.status, s.gross_salary, s.net_salary, s.present_days, r.run_month FROM salary_prep_line s JOIN salary_prep_run r ON r.id = s.run_id WHERE s.employee_id = ? ORDER BY r.run_month DESC LIMIT 3`, [id]);
    console.log("  HRMS payroll lines (latest 3):", JSON.stringify(pay));
    const sal = await q(`SELECT (SELECT COUNT(*) FROM employee_salary_assignment WHERE employee_id=?) esa, (SELECT COUNT(*) FROM salary_component_assignments WHERE employee_id=? AND status='active') sca_active`, [id, id]);
    console.log("  HRMS salary assignment:", JSON.stringify(sal[0]));
    const ex = await q(`SELECT status, created_at FROM exit_request WHERE employee_id = ? ORDER BY created_at DESC LIMIT 2`, [id]);
    console.log("  HRMS exit_request:", JSON.stringify(ex.map((x) => ({ status: x.status, created: d10(x.created_at) }))));
  }

  console.log("\n== db_bill masjclrentry ==");
  const b = await billQuery<RowDataPacket>(
    `SELECT EmpCode, EmpName, DOB, DOJ, DOL, Status, left_type, ResignationDate, BranchName, CostCenter, Desgination, RIGHT(Mobile,4) m4, PanNo, AdharId, lastUpdated, Gross
       FROM masjclrentry WHERE UPPER(TRIM(EmpCode)) = ? LIMIT 3`, [CODE]);
  console.log("rows:", b.length);
  for (const r of b) {
    const { PanNo, AdharId, ...rest } = r;
    console.log(" ", JSON.stringify({ ...rest, DOB: d10(r.DOB), DOJ: d10(r.DOJ), DOL: d10(r.DOL), ResignationDate: d10(r.ResignationDate), lastUpdated: d10(r.lastUpdated) }));
    const pan = norm(PanNo), aad = String(AdharId ?? "").replace(/\D/g, "");
    const okP = /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan), okA = aad.length === 12;
    if (okP || okA) {
      const sib = await billQuery<RowDataPacket>(
        `SELECT EmpCode, EmpName, DOJ, DOL, Status FROM masjclrentry WHERE UPPER(TRIM(EmpCode)) <> ? AND ((? <> '' AND UPPER(TRIM(PanNo)) = ?) OR (? <> '' AND REPLACE(AdharId,' ','') = ?)) LIMIT 8`,
        [CODE, okP ? pan : "", pan, okA ? aad : "", aad]);
      console.log(`  db_bill other codes, same PAN/Aadhaar: ${sib.length}`, sib.length ? JSON.stringify(sib.map((s) => ({ ...s, DOJ: d10(s.DOJ), DOL: d10(s.DOL) }))) : "");
      for (const s of sib) {
        const hs = await q(`SELECT employee_code, active_status, date_of_exit FROM employees WHERE UPPER(TRIM(employee_code)) = ?`, [norm(s.EmpCode)]);
        console.log(`    HRMS for ${String(s.EmpCode).trim()}:`, JSON.stringify(hs.map((x) => ({ ...x, date_of_exit: d10(x.date_of_exit) }))));
      }
    }
    const att = await billQuery<RowDataPacket>(`SELECT Status s, COUNT(*) n, MIN(AttandDate) f, MAX(AttandDate) l FROM Attandence WHERE UPPER(TRIM(EmpCode)) = ? AND AttandDate >= '2026-07-31' GROUP BY Status`, [CODE]).catch(() => []);
    console.log("  db_bill attendance since Aug:", JSON.stringify(att.map((a) => ({ ...a, f: d10(a.f), l: d10(a.l) }))));
    const sal = await billQuery<RowDataPacket>(`SELECT DATE_FORMAT(SalDate,'%Y-%m') m, Gross, EarnedDays, NetSalary FROM salary_data WHERE UPPER(TRIM(EmpCode)) = ? ORDER BY SalDate DESC LIMIT 3`, [CODE]).catch(() => []);
    console.log("  db_bill salary_data (latest 3):", JSON.stringify(sal));
  }
  if (h.length === 1 && b.length === 1) {
    const hn = `${h[0].first_name} ${h[0].last_name ?? ""}`.trim().toUpperCase();
    console.log(`\nSAME PERSON CHECK: name ${hn === norm(b[0].EmpName)} | DOB ${d10(h[0].date_of_birth) === d10(b[0].DOB)} | DOJ ${d10(h[0].date_of_joining) === d10(b[0].DOJ)} | mobile last4 ${l4(h[0].m4) === l4(b[0].m4)} | PAN ${norm(h[0].pan_number) === norm(b[0].PanNo)} | Aadhaar last4 ${String(h[0].aadhaar_last4 ?? "") === String(b[0].AdharId ?? "").replace(/\s/g, "").slice(-4)}`);
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(async () => { await closeBillPool().catch(() => {}); process.exit(process.exitCode ?? 0); });
