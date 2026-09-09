/**
 * Idempotent healer for the 2026-09-08 owner-directed db_bill alignment.
 *
 * WHY THIS EXISTS. The override mechanism (force-match-dbbill-net.mts, then
 * force-match-dbbill-components.mts) patches salary_prep_line directly, outside the payroll
 * engine. The engine has no knowledge of it, so ANY future recalculation of an overridden
 * employee -- a new regularization, a manual re-run, anything that calls
 * calculatePayrollRunScoped for them -- silently discards the override and replaces it with the
 * engine's own formula-derived figures. This already happened once (MAS63361, caught and
 * manually re-fixed same day). It will happen again, silently, with no error, for as long as
 * payroll activity continues on this run.
 *
 * WHAT THIS SCRIPT DOES DIFFERENTLY FROM ITS PREDECESSORS. Rather than computing a target once
 * and logging a delta (which then requires tracing three separate sensitive_action_log entries
 * to reconstruct "what should this row be"), this reads db_bill's row live every time it runs and
 * treats it as the single durable source of truth. Re-running it costs nothing when nothing has
 * drifted -- it only writes rows that currently disagree with db_bill. Safe to run on a schedule
 * or whenever payroll activity on this run is suspected.
 *
 * SCOPE: identical to the original override -- NOIDA-2 and Ahmedabad-Jaldarshan, excluding
 * MAS63131 and MAS63178 (July-2026 arrears catch-up; matching db_bill there would claw back real
 * wages owed for a locked month, not fix a component disagreement -- deliberately never healed).
 *
 * Components covered: gross_salary, pf_employee, esic_employee, professional_tax, tds, loan_emi,
 * other_deductions, incentive_total, net_salary. incentive_total was missing from the original
 * component pass -- see MAS63361 in the reconciliation log for what that gap costs when a
 * reversion exposes it.
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
const EXCLUDE_CODES = ["MAS63131", "MAS63178"]; // July-2026 arrears -- never force-matched
const inr = (n: any) => "Rs " + Math.round(Number(n || 0)).toLocaleString("en-IN");

async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 1; ; i++) {
    try { return await fn(); }
    catch (err: any) {
      if ((err?.errno !== 1213 && err?.errno !== 1205) || i >= attempts) throw err;
      const wait = 500 * 2 ** (i - 1);
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
  `SELECT EmpCode, ROUND(Gross1,2) gross, ROUND(Incentive,2) inc, ROUND(EPF,2) pf,
          ROUND(ESIC,2) esic, ROUND(ProTaxDeduction,2) pt, ROUND(IncomeTax,2) tds,
          ROUND(LoanDed,2) loan, ROUND(OtherDeduction,2) oth, ROUND(NetSalary,2) net
     FROM salary_data WHERE SalDate='2026-08-31'`);
await bill.end();
const billOf = new Map<string, any>(
  billRows.map((r: any) => [String(r.EmpCode).trim().toUpperCase(), r]));

const [lines]: any = await db.query(
  `SELECT l.id, e.employee_code c, COALESCE(bm.branch_name,'-') br,
          ROUND(l.gross_salary,2) gross, ROUND(l.incentive_total,2) inc, ROUND(l.pf_employee,2) pf,
          ROUND(l.esic_employee,2) esic, ROUND(l.professional_tax,2) pt, ROUND(l.tds,2) tds,
          ROUND(l.loan_emi,2) loan, ROUND(l.other_deductions,2) oth, ROUND(l.net_salary,2) net
     FROM salary_prep_line l
     JOIN employees e ON e.id = l.employee_id
     LEFT JOIN branch_master bm ON bm.id = e.branch_id
    WHERE l.run_id = ? AND bm.branch_name IN (?)
      AND e.employee_code NOT IN (?)`, [RUN, BRANCHES, EXCLUDE_CODES]);

const COLS: Array<[string, string]> = [
  ["gross", "gross"], ["inc", "inc"], ["pf", "pf"], ["esic", "esic"], ["pt", "pt"],
  ["tds", "tds"], ["loan", "loan"], ["oth", "oth"], ["net", "net"],
];

const drifted: any[] = [];
for (const l of lines) {
  const r = billOf.get(String(l.c).trim().toUpperCase());
  if (!r) continue;
  const diffs = COLS.filter(([hk, bk]) => Math.abs(Number(l[hk]) - Number(r[bk])) > 1);
  if (diffs.length) drifted.push({ ...l, target: r, diffs: diffs.map(([hk]) => hk) });
}

console.log(`${APPLY ? "APPLY" : "DRY RUN"}`);
console.log(`Checked ${lines.length} employees (${BRANCHES.join(", ")}, excluding ${EXCLUDE_CODES.join(", ")})`);
console.log(`Currently drifted from db_bill: ${drifted.length}\n`);
for (const d of drifted)
  console.log(`  ${d.c.padEnd(10)} ${d.br.padEnd(22)} drifted: ${d.diffs.join(", ")}  (net ${d.net} -> ${d.target.net})`);

if (!drifted.length) { console.log("Nothing to heal."); process.exit(0); }
if (!APPLY) { console.log("\nNo changes written. Re-run with APPLY=1."); process.exit(0); }

const NOTE = "Healed by heal-dbbill-alignment.mts (idempotent re-run of the 2026-09-08 " +
  "owner-directed override) -- this row had drifted from db_bill, most likely because a " +
  "payroll recalculation ran on it after the original override, which the engine has no " +
  "knowledge of. Re-synced to db_bill's live reported figures.";

for (const d of drifted) {
  const t = d.target;
  await withRetry(`heal ${d.c}`, () =>
    db.query(
      `UPDATE salary_prep_line
          SET gross_salary=?, incentive_total=?, pf_employee=?, esic_employee=?,
              professional_tax=?, tds=?, loan_emi=?, other_deductions=?, net_salary=?,
              arrears_note = CONCAT(COALESCE(arrears_note,''), ' | ', ?)
        WHERE id=?`,
      [t.gross, t.inc, t.pf, t.esic, t.pt, t.tds, t.loan, t.oth, t.net, NOTE, d.id]));
}
await db.query(
  `INSERT INTO sensitive_action_log
     (id, actor_user_id, action_type, module_key, entity_type, change_summary, acted_at, reason)
   VALUES (UUID(), ?, 'DBBILL_ALIGNMENT_HEALED', 'payroll', 'salary_prep_line', ?, NOW(), ?)`,
  [ACTOR, JSON.stringify({ run: RUN, healed: drifted.map(d => ({ code: d.c, diffs: d.diffs })) }), NOTE]);

console.log(`\nHealed ${drifted.length} employees.`);
process.exit(0);
