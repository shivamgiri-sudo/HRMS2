/**
 * How salary increments and salary changes reach payroll. STRICTLY READ-ONLY (SELECT only).
 *
 *   npx tsx scripts/salary-change-flow-audit.ts
 *
 * Payroll prices a month from salary_component_assignments (sca: active row, latest effective_date, NO month
 * filter) and uses employee_salary_assignment (esa) only to choose WHO is in the run. Increments
 * (salary_increment_request -> implement) write esa only; the Salary Change Center writes sca. This measures:
 *   1  implemented increment requests whose new CTC never reached the employee's active package (sca)
 *   2  salary changes (employee_salary_change_log) taking effect mid-month (day > 1): the engine pays the whole
 *      month at the new package, with no old/new split
 *   3  active sca rows dated AFTER today (future-dated, but already used by any open run)
 *   4  active sca rows dated after the start of an open run month they are priced into
 * Employee code only, no PII.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db, closePool } from "../src/db/mysql.js";

const q = async (sql: string, p: unknown[] = []) => {
  if (!/^\s*select/i.test(sql)) throw new Error("read-only");
  const [rows] = await db.execute<RowDataPacket[]>(sql, p as any[]);
  return rows as any[];
};
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

async function main() {
  console.log("1. implemented increment requests since 2026-04-01 vs the active package payroll uses");
  const inc = await q(
    `SELECT e.employee_code, r.status, r.effective_from, r.implemented_at, ROUND(r.proposed_ctc) AS req_ctc_annual_or_monthly,
            r.new_assignment_id IS NOT NULL AS esa_row_created,
            (SELECT ROUND(a.ctc_annual) FROM employee_salary_assignment a WHERE a.employee_id = r.employee_id AND a.active_status = 1 ORDER BY a.effective_from DESC LIMIT 1) AS active_esa_ctc,
            (SELECT s.gross FROM salary_component_assignments s WHERE s.employee_id = r.employee_id AND s.status = 'active' ORDER BY s.effective_date DESC LIMIT 1) AS active_sca_gross,
            (SELECT s.effective_date FROM salary_component_assignments s WHERE s.employee_id = r.employee_id AND s.status = 'active' ORDER BY s.effective_date DESC LIMIT 1) AS active_sca_effective
       FROM salary_increment_request r JOIN employees e ON e.id = r.employee_id
      WHERE r.status = 'implemented' AND r.effective_from >= '2026-04-01'
      ORDER BY r.effective_from DESC LIMIT 60`).catch((x) => { console.log("  skipped:", String(x.message).slice(0, 100)); return []; });
  console.log(`  implemented requests (max 60 shown): ${inc.length}`);
  console.table(inc.map((r) => ({
    code: r.employee_code, effective_from: String(r.effective_from).slice(0, 10), request_ctc: r.req_ctc_annual_or_monthly, esa_row_created: r.esa_row_created ? "yes" : "NO",
    active_esa_ctc: r.active_esa_ctc, sca_gross: r.active_sca_gross, sca_effective: r.active_sca_effective ? String(r.active_sca_effective).slice(0, 10) : null,
    sca_older_than_increment: r.active_sca_effective && new Date(r.active_sca_effective) < new Date(r.effective_from) ? "YES - payroll still on the old package" : "no",
  })));

  console.log("2. salary changes since 2026-06-01 by effective day");
  console.table(await q(
    `SELECT DATE_FORMAT(effective_date, '%Y-%m') AS month, COUNT(*) AS changes, SUM(DAY(effective_date) > 1) AS mid_month, SUM(effective_date > CURDATE()) AS future_dated
       FROM employee_salary_change_log WHERE effective_date >= '2026-06-01' GROUP BY 1 ORDER BY 1`).catch((x) => [{ note: String(x.message).slice(0, 100) }]));
  console.log("   sample mid-month changes (latest 15):");
  console.table((await q(
    `SELECT e.employee_code, l.effective_date, ROUND(l.old_ctc) AS old_ctc, ROUND(l.new_ctc) AS new_ctc, l.created_at
       FROM employee_salary_change_log l JOIN employees e ON e.id = l.employee_id
      WHERE l.effective_date >= '2026-06-01' AND DAY(l.effective_date) > 1 ORDER BY l.created_at DESC LIMIT 15`).catch(() => [])).map((r) => ({ ...r, effective_date: String(r.effective_date).slice(0, 10), created_at: String(r.created_at).slice(0, 16) })));

  console.log("3. active sca rows dated after today:");
  const fut = await q(`SELECT e.employee_code, s.effective_date, s.gross FROM salary_component_assignments s JOIN employees e ON e.id = s.employee_id WHERE s.status = 'active' AND s.effective_date > CURDATE() ORDER BY s.effective_date LIMIT 40`);
  console.log(`   count shown (max 40): ${fut.length}`);
  console.table(fut.map((r) => ({ code: r.employee_code, effective: String(r.effective_date).slice(0, 10), gross: n(r.gross) })));

  console.log("4. open runs and active sca rows dated after the run month starts:");
  console.table(await q(
    `SELECT r.run_month, r.status AS run_status,
            COUNT(DISTINCT s.employee_id) AS employees_priced_by_a_later_dated_package
       FROM salary_prep_run r
       JOIN salary_prep_line l ON l.run_id = r.id
       JOIN salary_component_assignments s ON s.employee_id = l.employee_id AND s.status = 'active'
      WHERE LOWER(r.status) NOT IN ('draft','cancelled','finalized','disbursed','locked','closed')
        AND s.effective_date > CONCAT(r.run_month, '-01') AND s.effective_date > l.created_at - INTERVAL 400 DAY
      GROUP BY r.run_month, r.status ORDER BY r.run_month DESC LIMIT 6`).catch((x) => [{ note: String(x.message).slice(0, 100) }]));
}

main().then(() => closePool()).catch(async (e) => { console.error("ERR", e?.message ?? e); try { await closePool(); } catch { } process.exit(1); });
