/** Employees still left off the Aug salary voucher after the trainee rule. READ-ONLY. npx tsx scripts/voucher-unassigned-detail.ts */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";
import { salaryVoucherService } from "../src/modules/finance/salary-voucher.service.js";

async function main() {
  const [runs] = await db.execute<RowDataPacket[]>(`SELECT id FROM salary_prep_run WHERE run_month = '2026-08' AND (created_by IS NULL OR created_by <> 'test-auto-gen') LIMIT 1`);
  const runId = (runs as any[])[0].id;
  const gen = await salaryVoucherService.generate(String(runId), { serialFrom: 900001 });
  console.log(`unassigned ${gen.unassigned.length}, unpaid ${gen.unpaid.length}, vouchers ${gen.vouchers.length}`);
  if (gen.unassigned.length) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT l.employee_code, e.employment_type, bm.branch_name, ROUND(l.net_salary,2) net
         FROM salary_prep_line l JOIN employees e ON e.id = l.employee_id LEFT JOIN branch_master bm ON bm.id = e.branch_id
        WHERE l.run_id = ? AND l.employee_code IN (${gen.unassigned.map(() => "?").join(",")}) ORDER BY l.net_salary DESC`, [runId, ...gen.unassigned]);
    console.table(rows);
  }
}
main().then(() => db.end?.()).catch(async (e) => { console.error("ERR", e?.message ?? e); try { await db.end?.(); } catch { } process.exit(1); });
