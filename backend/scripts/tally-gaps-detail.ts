/** Detail for two validator findings. STRICTLY READ-ONLY.  npx tsx scripts/tally-gaps-detail.ts */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { billQuery, closeBillPool } from "../src/db/billDb.js";

const q = async (label: string, sql: string, params: unknown[] = []) => {
  try { const [rows] = await db.execute<RowDataPacket[]>(sql, params); console.log(`\n## ${label}`); console.table(rows); return rows as any[]; }
  catch (e: any) { console.log(`\n## ${label}\nSKIPPED: ${e.message}`); return []; }
};

async function main() {
  await q("GST rows that do not add up and are not flagged",
    `SELECT b.export_type, b.period_month, r.bill_no, r.source_type, r.supply_type, r.gst_type, r.taxable_value, r.igst_amount, r.cgst_amount, r.sgst_amount,
            r.other_charges, r.round_off_amount, r.invoice_value, r.validation_status
       FROM gst_export_row r JOIN gst_export_batch b ON b.id = r.batch_id AND b.status <> 'superseded'
      WHERE r.validation_status <> 'exception'
        AND ABS(r.invoice_value - (r.taxable_value + r.igst_amount + r.cgst_amount + r.sgst_amount + COALESCE(r.other_charges,0) + COALESCE(r.round_off_amount,0))) > 1.01`);

  const runs = await q("run", `SELECT id FROM salary_prep_run WHERE run_month = '2026-08' AND (created_by IS NULL OR created_by <> 'test-auto-gen') LIMIT 1`);
  const runId = runs[0].id;
  const codes = await q("sample of employee codes left off the Aug voucher (no MAS/IDC prefix, paid)",
    `SELECT l.employee_code, ROUND(l.net_salary,2) net, ROUND(l.gross_salary,2) gross, e.employment_type, bm.branch_name
       FROM salary_prep_line l JOIN employees e ON e.id = l.employee_id LEFT JOIN branch_master bm ON bm.id = e.branch_id
      WHERE l.run_id = ? AND l.employee_code NOT REGEXP '^(MAS|IDC)' AND l.net_salary > 0 ORDER BY l.net_salary DESC LIMIT 12`, [runId]);
  await q("their shape: how many, what do the codes look like, by branch",
    `SELECT COALESCE(bm.branch_name,'(none)') branch, COUNT(*) n, ROUND(SUM(l.net_salary)) net, MIN(l.employee_code) min_code, MAX(l.employee_code) max_code
       FROM salary_prep_line l JOIN employees e ON e.id = l.employee_id LEFT JOIN branch_master bm ON bm.id = e.branch_id
      WHERE l.run_id = ? AND l.employee_code NOT REGEXP '^(MAS|IDC)' AND l.net_salary > 0 GROUP BY branch ORDER BY net DESC`, [runId]);
  const sample = codes.slice(0, 6).map((c) => c.employee_code);
  if (sample.length) {
    const bill = await billQuery<any>(`SELECT EmpCode, Branch, NetSalary, Gross1 FROM salary_data WHERE SalDate >= '2026-08-01' AND SalDate < '2026-09-01' AND EmpCode IN (${sample.map(() => "?").join(",")})`, sample);
    console.log("\n## same codes in db_bill"); console.table(bill);
  }
  const bill2 = await billQuery<any>(
    `SELECT Branch, COUNT(*) n, ROUND(SUM(NetSalary)) net, MIN(EmpCode) min_code FROM salary_data
      WHERE SalDate >= '2026-08-01' AND SalDate < '2026-09-01' AND EmpCode REGEXP '^[0-9]+C$' GROUP BY Branch`);
  console.log("\n## db_bill Aug rows whose code is digits + C"); console.table(bill2);
  const bill3 = await billQuery<any>(
    `SELECT Branch, COUNT(*) n, ROUND(SUM(NetSalary)) net FROM salary_data WHERE SalDate >= '2026-08-01' AND SalDate < '2026-09-01' AND EmpCode LIKE 'MAS%' AND Branch LIKE 'AHMEDABAD%' GROUP BY Branch`);
  console.log("\n## db_bill Aug MAS-prefixed rows at Ahmedabad"); console.table(bill3);
  await closeBillPool();
}
main().then(() => db.end?.()).catch(async (e) => { console.error("ERR", e?.message ?? e); try { await db.end?.(); } catch { } process.exit(1); });
