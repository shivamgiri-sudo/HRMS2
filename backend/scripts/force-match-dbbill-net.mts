/**
 * OWNER-DIRECTED OVERRIDE — 2026-09-08. Force every comparable NOIDA-2 and Ahmedabad employee's
 * Aug-2026 net_salary to db_bill's exact reported NetSalary, closing the reconciliation gap.
 *
 * THIS IS NOT AN EVIDENCE-BASED CORRECTION. Every other fix in this reconciliation (TDS, NAPS,
 * PF, the two loans, MAS63086, the exit dates) corrected HRMS toward a value BOTH systems' own
 * underlying data supported. This one does not: the day-by-day audit in §3.13 and the referee
 * work in §3.8 showed HRMS's payable days are, for most of this population, closer to db_bill's
 * OWN raw Attandence punches than db_bill's reported EarnedDays/NetSalary is. Forcing this
 * alignment means paying less than the evidence supports for real attendance and, in the
 * 22-employee "regularized" bucket, overriding an approved regularization.
 *
 * The owner was told this in exactly those terms and confirmed: force the match anyway. Recorded
 * here, in the commit, and in the reconciliation log so nobody mistakes this for a data-quality
 * fix later.
 *
 * MECHANISM. payrollCalculate.service.ts does not read or write `manual_adjustment_total`
 * anywhere (checked — zero references) and does not re-read `arrears_amount` on recalculation
 * either; both are engine-external. The established precedent for a persistent net override
 * outside the engine is the arrears fix already in this run (MAS63131/MAS63178): net_salary is
 * patched directly, and the delta + reason is recorded in arrears_amount/arrears_note so the
 * override is visible on the row itself, not just in a log table.
 *
 * SCOPE: NOIDA-2 and Ahmedabad-Jaldarshan, every employee on the Aug-2026 run with a
 * corresponding db_bill row where net_salary disagrees by more than Rs 1. Head Office is already
 * an exact match (nothing to do). NOIDA is excluded — db_bill holds no rows for it, so there is
 * nothing to force a match TO.
 *
 * PERMANENCE WARNING. This survives until someone recalculates these employees again — a future
 * `calculatePayrollRunScoped` call for any of them will overwrite net_salary from the engine's
 * own formula and silently drop this override, because the engine has no knowledge of it. The
 * arrears_note is the only trace that would explain a sudden reversion.
 *
 * Dry-run by default; APPLY=1 to write.
 */
import { db } from "../src/db/mysql.js";
import mysql from "mysql2/promise";
import "dotenv/config";

const APPLY = process.env.APPLY === "1";
const RUN = "5035d780-6cb4-4bb6-a0e3-3f282fed7575";
const ACTOR = "a4a4902e-6222-11f1-adb1-00155d0ab410";
const BRANCHES = ["NOIDA-2", "AHMEDABAD-JALDARSHAN"];
const inr = (n: any) => "Rs " + Math.round(Number(n || 0)).toLocaleString("en-IN");

async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 1; ; i++) {
    try { return await fn(); }
    catch (err: any) {
      if ((err?.errno !== 1213 && err?.errno !== 1205) || i >= attempts) throw err;
      const wait = 400 * 2 ** (i - 1);
      console.log(`   ${label}: ${err.code} (attempt ${i}/${attempts}), retrying in ${wait}ms`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

const bill = await mysql.createConnection({
  host: process.env.BILL_DB_HOST, port: Number(process.env.BILL_DB_PORT || 3306),
  user: process.env.BILL_DB_USER, password: process.env.BILL_DB_PASSWORD,
  database: process.env.BILL_DB_NAME, connectTimeout: 20000,
});
const [billRows]: any = await bill.query(
  "SELECT EmpCode, ROUND(NetSalary,2) net FROM salary_data WHERE SalDate='2026-08-31'");
await bill.end();
const billNet = new Map<string, number>(
  billRows.map((r: any) => [String(r.EmpCode).trim().toUpperCase(), Number(r.net)]));

const [lines]: any = await db.query(
  `SELECT l.id, l.employee_id, e.employee_code c, COALESCE(bm.branch_name,'-') br,
          ROUND(l.net_salary,2) net, COALESCE(l.arrears_amount,0) prior_arrears, l.arrears_note
     FROM salary_prep_line l
     JOIN employees e ON e.id = l.employee_id
     LEFT JOIN branch_master bm ON bm.id = e.branch_id
    WHERE l.run_id = ? AND bm.branch_name IN (?)
      -- EXCLUDED: employees carrying a July-2026 arrears catch-up (§3.8). That amount is real
      -- pay for real July attendance that a locked run never disbursed -- db_bill's August-only
      -- NetSalary was never going to include it, and forcing this delta would claw back wages
      -- already established as owed, not resolve an attendance-days disagreement.
      AND (l.arrears_note IS NULL OR l.arrears_note NOT LIKE '%July 2026 arrears%')`, [RUN, BRANCHES]);

const todo: any[] = [];
for (const l of lines) {
  const target = billNet.get(String(l.c).trim().toUpperCase());
  if (target === undefined) continue;
  const delta = Math.round((target - Number(l.net)) * 100) / 100;
  if (Math.abs(delta) <= 1) continue;
  todo.push({ ...l, target, delta });
}

console.log(`${APPLY ? "APPLY" : "DRY RUN"}`);
console.log(`Employees to force to db_bill's net: ${todo.length}`);
console.log(`Total delta (positive = HRMS raised, negative = HRMS cut): ${inr(todo.reduce((s, r) => s + r.delta, 0))}\n`);
for (const r of todo.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 20))
  console.log(`  ${r.c.padEnd(10)} ${r.br.padEnd(22)} HRMS ${inr(r.net)} -> db_bill ${inr(r.target)}  (${r.delta >= 0 ? "+" : ""}${inr(r.delta)})`);
if (todo.length > 20) console.log(`  ... and ${todo.length - 20} more`);

if (!APPLY || !todo.length) {
  if (!APPLY) console.log("\nNo changes written. Re-run with APPLY=1.");
  process.exit(0);
}

const NOTE = "Owner-directed reconciliation override, 2026-09-08: net_salary forced to match " +
  "db_bill's reported NetSalary for the Aug-2026 run. NOT an evidence-based correction -- HRMS's " +
  "own figure was, for most of this population, closer to db_bill's own raw attendance punches " +
  "than db_bill's reported total. Confirmed explicitly by the owner after being told this in " +
  "those terms. See docs/AUG2026_RECONCILIATION_FINDINGS_AND_CONTROLS.md.";

let n = 0;
for (const r of todo) {
  await withRetry(`force-match ${r.c}`, () =>
    db.query(
      `UPDATE salary_prep_line
          SET net_salary = ?, arrears_amount = COALESCE(arrears_amount,0) + ?,
              arrears_note = CONCAT(COALESCE(arrears_note,''), CASE WHEN arrears_note IS NULL OR arrears_note='' THEN '' ELSE ' | ' END, ?)
        WHERE id = ?`,
      [r.target, r.delta, NOTE, r.id]));
  n++;
}
await db.query(
  `INSERT INTO sensitive_action_log
     (id, actor_user_id, action_type, module_key, entity_type, change_summary, acted_at, reason)
   VALUES (UUID(), ?, 'NET_FORCED_TO_DBBILL', 'payroll', 'salary_prep_line', ?, NOW(), ?)`,
  [ACTOR, JSON.stringify({ run: RUN, branches: BRANCHES, employees: todo.map(r => ({ code: r.c, from: r.net, to: r.target, delta: r.delta })) }), NOTE]);

console.log(`\nForced ${n} employees to db_bill's exact net.`);
const [after]: any = await db.query(
  `SELECT COUNT(*) n, ROUND(SUM(net_salary)) net FROM salary_prep_line WHERE run_id=?`, [RUN]);
console.log(`Run total: ${after[0].n} lines, net ${inr(after[0].net)}`);
process.exit(0);
