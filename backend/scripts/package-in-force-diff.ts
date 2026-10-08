/**
 * Impact preview for two payroll-package fixes. STRICTLY READ-ONLY (SELECT only), employee code only.
 *
 *   npx tsx scripts/package-in-force-diff.ts
 *
 * Fix 3 - price a month with the package in force for that month. Today the engine takes the active
 * salary_component_assignments (sca) row with the latest effective_date and ignores the run month. For every
 * OPEN run this lists employees whose active sca row is dated AFTER the run month ends AND which a salary change
 * (employee_salary_change_log) created, with the previous package the month should use instead.
 *
 * Fix 4 - an implemented increment must reach the package. Lists implemented salary_increment_request rows whose
 * employee's active sca row is older than the increment's effective date (payroll still prices the old package),
 * with the CTC the increment approved.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db, closePool } from "../src/db/mysql.js";

const q = async (sql: string, p: unknown[] = []) => {
  if (!/^\s*select/i.test(sql)) throw new Error("read-only");
  const [rows] = await db.execute<RowDataPacket[]>(sql, p as any[]);
  return rows as any[];
};
const d10 = (v: unknown) => (v ? String(v).slice(0, 10) : "");

async function main() {
  const runs = await q(`SELECT id, run_month, status FROM salary_prep_run WHERE LOWER(status) NOT IN ('draft','cancelled','finalized','disbursed','locked','closed') ORDER BY run_month DESC LIMIT 6`);
  console.log("open runs:", runs.map((r) => `${r.run_month} (${r.status})`).join(", ") || "none");

  console.log("\nFIX 3 - later-dated package priced into an open month, previous package available from the change log");
  for (const run of runs) {
    const rows = await q(
      `SELECT e.employee_code, new_a.effective_date AS new_effective, new_a.gross AS new_gross,
              old_a.effective_date AS old_effective, old_a.gross AS old_gross, l.effective_date AS change_effective
         FROM salary_prep_line spl
         JOIN employees e ON e.id = spl.employee_id
         JOIN salary_component_assignments new_a ON new_a.employee_id = spl.employee_id AND new_a.status = 'active'
         JOIN employee_salary_change_log l ON l.new_salary_component_assignment_id = new_a.id
         JOIN salary_component_assignments old_a ON old_a.id = l.old_salary_component_assignment_id
        WHERE spl.run_id = ? AND new_a.effective_date > LAST_DAY(CONCAT(?, '-01'))
        ORDER BY e.employee_code LIMIT 80`, [run.id, run.run_month]);
    console.log(`  run ${run.run_month}: ${rows.length} employee(s)`);
    if (rows.length) console.table(rows.map((r) => ({ code: r.employee_code, change_effective: d10(r.change_effective), sca_dated: d10(r.new_effective), priced_now_gross: Number(r.new_gross), should_price_gross: Number(r.old_gross) })));
  }

  console.log("\nFIX 3b - the same set where a change is dated INSIDE the run month (whole month priced at the new package, no day split)");
  for (const run of runs) {
    const rows = await q(
      `SELECT e.employee_code, l.effective_date, old_a.gross AS old_gross, new_a.gross AS new_gross, DAY(l.effective_date) AS day_of_month
         FROM salary_prep_line spl
         JOIN employees e ON e.id = spl.employee_id
         JOIN employee_salary_change_log l ON l.employee_id = spl.employee_id
         JOIN salary_component_assignments new_a ON new_a.id = l.new_salary_component_assignment_id
         JOIN salary_component_assignments old_a ON old_a.id = l.old_salary_component_assignment_id
        WHERE spl.run_id = ? AND DATE_FORMAT(l.effective_date, '%Y-%m') = ? AND DAY(l.effective_date) > 1
        ORDER BY l.effective_date LIMIT 60`, [run.id, run.run_month]);
    console.log(`  run ${run.run_month}: ${rows.length} employee(s) with a mid-month change`);
    if (rows.length) console.table(rows.map((r) => ({ code: r.employee_code, effective: d10(r.effective_date), old_gross: Number(r.old_gross), new_gross: Number(r.new_gross), days_at_old: Number(r.day_of_month) - 1 })));
  }

  console.log("\nFIX 4 - implemented increments whose package (sca) is older than the increment");
  const inc = await q(
    `SELECT e.employee_code, r.effective_from, ROUND(r.proposed_ctc/12) AS approved_monthly_ctc,
            (SELECT s.gross FROM salary_component_assignments s WHERE s.employee_id = r.employee_id AND s.status = 'active' ORDER BY s.effective_date DESC LIMIT 1) AS sca_gross,
            (SELECT s.effective_date FROM salary_component_assignments s WHERE s.employee_id = r.employee_id AND s.status = 'active' ORDER BY s.effective_date DESC LIMIT 1) AS sca_effective
       FROM salary_increment_request r JOIN employees e ON e.id = r.employee_id AND e.active_status = 1
      WHERE r.status = 'implemented' AND r.effective_from >= '2026-01-01'
      HAVING sca_effective IS NOT NULL AND sca_effective < effective_from
      ORDER BY r.effective_from DESC LIMIT 200`);
  console.log(`  ${inc.length} employee(s)`);
  console.table(inc.map((r) => ({ code: r.employee_code, increment_effective: d10(r.effective_from), approved_monthly_ctc: Number(r.approved_monthly_ctc), sca_gross: Number(r.sca_gross), sca_dated: d10(r.sca_effective) })));
}

main().then(() => closePool()).catch(async (e) => { console.error("ERR", e?.message ?? e); try { await closePool(); } catch { } process.exit(1); });
