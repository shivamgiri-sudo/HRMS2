/**
 * Real salary increments recorded in db_bill, compared with HRMS. STRICTLY READ-ONLY on both databases.
 *
 *   npx tsx scripts/dbbill-increments-audit.ts [YYYY-MM]    (month the increment shows up in; default 2026-08)
 *
 * 1. Lists db_bill tables whose name mentions increment/revision/hike.
 * 2. An increment = an employee whose monthly Gross entitlement in db_bill changed between the previous month's
 *    row and this month's row (both > 0). For each: db_bill old/new gross, HRMS active package gross, HRMS
 *    salary-assignment CTC, and whether HRMS already reflects it. Employee code only.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db, closePool } from "../src/db/mysql.js";
import { billQuery, closeBillPool } from "../src/db/billDb.js";

const month = process.argv.find((a) => /^\d{4}-\d{2}$/.test(a)) ?? "2026-08";
const prev = (() => { const [y, m] = month.split("-").map(Number); const d = new Date(Date.UTC(y!, m! - 2, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; })();

async function main() {
  const tables = await billQuery<any>(`SHOW TABLES`);
  const names = tables.map((t) => String(Object.values(t)[0]));
  console.log("db_bill tables mentioning increment/revision/hike:", names.filter((n) => /incre|revis|hike|appraisal/i.test(n)).join(", ") || "none");

  const rows = await billQuery<any>(
    `SELECT TRIM(a.EmpCode) AS code, a.Gross AS new_gross, b.Gross AS old_gross, a.CTC AS new_ctc, b.CTC AS old_ctc, a.SalayDate AS new_date
       FROM salary_data a
       JOIN salary_data b ON TRIM(b.EmpCode) = TRIM(a.EmpCode) AND DATE_FORMAT(b.SalayDate,'%Y-%m') = ?
      WHERE DATE_FORMAT(a.SalayDate,'%Y-%m') = ? AND a.EmpCode NOT LIKE 'IDC%' AND a.Gross > 0 AND b.Gross > 0 AND ABS(a.Gross - b.Gross) > 1
      ORDER BY a.EmpCode`, [prev, month]);
  console.log(`db_bill: ${rows.length} employees whose gross changed ${prev} -> ${month}`);
  const out: any[] = [];
  for (const r of rows) {
    const [h] = await db.execute<RowDataPacket[]>(
      `SELECT e.id, e.employee_code, e.employment_status,
              (SELECT s.gross FROM salary_component_assignments s WHERE s.employee_id = e.id AND s.status='active' ORDER BY s.effective_date DESC LIMIT 1) AS sca_gross,
              (SELECT s.effective_date FROM salary_component_assignments s WHERE s.employee_id = e.id AND s.status='active' ORDER BY s.effective_date DESC LIMIT 1) AS sca_date,
              (SELECT ROUND(a.ctc_annual/12) FROM employee_salary_assignment a WHERE a.employee_id = e.id AND a.active_status=1 ORDER BY a.effective_from DESC LIMIT 1) AS esa_monthly_ctc,
              (SELECT COUNT(*) FROM salary_increment_request q WHERE q.employee_id = e.id AND q.source='hrms') AS hrms_requests,
              (SELECT COUNT(*) FROM employee_salary_change_log l WHERE l.employee_id = e.id) AS change_log_rows
         FROM employees e WHERE e.employee_code = ? LIMIT 1`, [r.code]);
    const e = (h as any[])[0];
    out.push({
      code: r.code, db_bill_old_gross: Number(r.old_gross), db_bill_new_gross: Number(r.new_gross), db_bill_new_ctc: Number(r.new_ctc),
      hrms_status: e?.employment_status ?? "NOT IN HRMS", hrms_sca_gross: e?.sca_gross == null ? null : Number(e.sca_gross),
      sca_dated: e?.sca_date ? String(e.sca_date).slice(0, 10) : null, esa_monthly_ctc: e?.esa_monthly_ctc == null ? null : Number(e.esa_monthly_ctc),
      hrms_requests: Number(e?.hrms_requests ?? 0), change_log_rows: Number(e?.change_log_rows ?? 0),
      hrms_reflects: e?.sca_gross != null && Math.abs(Number(e.sca_gross) - Number(r.new_gross)) <= 1 ? "yes" : "NO",
    });
  }
  console.table(out.slice(0, 60));
  console.log(`already reflected in HRMS: ${out.filter((o) => o.hrms_reflects === "yes").length}; not reflected: ${out.filter((o) => o.hrms_reflects !== "yes").length}`);
}

main().then(async () => { await closeBillPool(); await closePool(); }).catch(async (e) => { console.error("ERR", e?.message ?? e); try { await closeBillPool(); await closePool(); } catch { } process.exit(1); });
