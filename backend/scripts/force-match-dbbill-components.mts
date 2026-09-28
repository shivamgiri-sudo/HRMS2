/**
 * Completes force-match-dbbill-net.mts. That script patched net_salary via a lump-sum
 * arrears_amount delta -- net matched, but gross/PF/ESIC/professional_tax/TDS/loan/other still
 * held HRMS's own (higher, evidence-based) figures underneath it. A payslip built from that row
 * would show a net that reconciles to db_bill while every line above it does not -- worse than
 * either a full match or full disclosure.
 *
 * This sets every component directly from db_bill's own reported columns (Gross1, EPF, ESIC,
 * ProTaxDeduction, IncomeTax, LoanDed, OtherDeduction, NetSalary) so the row is internally
 * consistent AND matches the register end to end, then reverses the earlier lump-sum patch
 * (whose delta is read back from the NET_FORCED_TO_DBBILL sensitive_action_log entry) so nothing
 * double-counts.
 *
 * SCOPE: identical population to the net-only pass -- NOIDA-2 and Ahmedabad-Jaldarshan, excluding
 * the two July-arrears employees (MAS63131, MAS63178), whose gap is real wages owed for a locked
 * month, not a component disagreement.
 *
 * Same owner-directed authorization as the net-only pass. Not an evidence-based correction.
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
  `SELECT EmpCode, ROUND(Gross1,2) gross, ROUND(EPF,2) pf, ROUND(ESIC,2) esic,
          ROUND(ProTaxDeduction,2) pt, ROUND(IncomeTax,2) tds, ROUND(LoanDed,2) loan,
          ROUND(OtherDeduction,2) oth, ROUND(NetSalary,2) net
     FROM salary_data WHERE SalDate='2026-08-31'`);
await bill.end();
const billOf = new Map<string, any>(
  billRows.map((r: any) => [String(r.EmpCode).trim().toUpperCase(), r]));

// Read back the delta the net-only pass applied, so it can be reversed exactly.
const [priorLog]: any = await db.query(
  `SELECT change_summary FROM sensitive_action_log
    WHERE action_type='NET_FORCED_TO_DBBILL' ORDER BY acted_at DESC LIMIT 1`);
const priorDeltas = new Map<string, number>();
if (priorLog.length) {
  const raw = priorLog[0].change_summary;
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  for (const e of parsed.employees ?? []) priorDeltas.set(e.code, Number(e.delta));
}
console.log(`Reversing ${priorDeltas.size} deltas from the prior net-only pass.`);

const [lines]: any = await db.query(
  `SELECT l.id, l.employee_id, e.employee_code c, COALESCE(bm.branch_name,'-') br,
          COALESCE(l.arrears_amount,0) arrears, l.arrears_note,
          ROUND(l.gross_salary,2) gross, ROUND(l.pf_employee,2) pf, ROUND(l.esic_employee,2) esic,
          ROUND(l.professional_tax,2) pt, ROUND(l.tds,2) tds, ROUND(l.loan_emi,2) loan,
          ROUND(l.other_deductions,2) oth, ROUND(l.net_salary,2) net
     FROM salary_prep_line l
     JOIN employees e ON e.id = l.employee_id
     LEFT JOIN branch_master bm ON bm.id = e.branch_id
    WHERE l.run_id = ? AND bm.branch_name IN (?)
      AND (l.arrears_note IS NULL OR l.arrears_note NOT LIKE '%July 2026 arrears%')`, [RUN, BRANCHES]);

const COLS: Array<[string, string]> = [
  ["gross", "gross"], ["pf", "pf"], ["esic", "esic"], ["pt", "pt"],
  ["tds", "tds"], ["loan", "loan"], ["oth", "oth"], ["net", "net"],
];

const todo: any[] = [];
for (const l of lines) {
  const r = billOf.get(String(l.c).trim().toUpperCase());
  if (!r) continue;
  const diffs = COLS.filter(([hk, bk]) => Math.abs(Number(l[hk]) - Number(r[bk])) > 1);
  if (!diffs.length) continue;
  todo.push({ ...l, target: r, diffCount: diffs.length, priorDelta: priorDeltas.get(l.c) ?? 0 });
}

console.log(`${APPLY ? "APPLY" : "DRY RUN"}`);
console.log(`Employees needing component-level alignment: ${todo.length}\n`);
for (const r of todo.slice(0, 15)) {
  console.log(`  ${r.c.padEnd(10)} ${r.br.padEnd(22)} ${r.diffCount} component(s) differ  ` +
    `(gross ${r.gross}->${r.target.gross}, PF ${r.pf}->${r.target.pf}, ESIC ${r.esic}->${r.target.esic}, ` +
    `PT ${r.pt}->${r.target.pt})`);
}
if (todo.length > 15) console.log(`  ... and ${todo.length - 15} more`);

if (!APPLY || !todo.length) {
  if (!APPLY) console.log("\nNo changes written. Re-run with APPLY=1.");
  process.exit(0);
}

const NOTE = "Owner-directed reconciliation override, 2026-09-08 (component-level pass): every " +
  "salary component set directly to db_bill's reported figure so the row is internally " +
  "consistent, not just net-matched via a lump adjustment. Supersedes the earlier lump-sum " +
  "arrears patch from this same run, which is reversed here. See " +
  "docs/AUG2026_RECONCILIATION_FINDINGS_AND_CONTROLS.md.";

let n = 0;
for (const r of todo) {
  const t = r.target;
  await withRetry(`align ${r.c}`, () =>
    db.query(
      `UPDATE salary_prep_line
          SET gross_salary = ?, pf_employee = ?, esic_employee = ?, professional_tax = ?,
              tds = ?, loan_emi = ?, other_deductions = ?, net_salary = ?,
              arrears_amount = COALESCE(arrears_amount,0) - ?,
              arrears_note = CONCAT(COALESCE(arrears_note,''), CASE WHEN arrears_note IS NULL OR arrears_note='' THEN '' ELSE ' | ' END, ?)
        WHERE id = ?`,
      [t.gross, t.pf, t.esic, t.pt, t.tds, t.loan, t.oth, t.net, r.priorDelta, NOTE, r.id]));
  n++;
}
await db.query(
  `INSERT INTO sensitive_action_log
     (id, actor_user_id, action_type, module_key, entity_type, change_summary, acted_at, reason)
   VALUES (UUID(), ?, 'COMPONENTS_FORCED_TO_DBBILL', 'payroll', 'salary_prep_line', ?, NOW(), ?)`,
  [ACTOR, JSON.stringify({ run: RUN, branches: BRANCHES,
    employees: todo.map(r => ({ code: r.c, from: { gross: r.gross, pf: r.pf, esic: r.esic, pt: r.pt, tds: r.tds, loan: r.loan, oth: r.oth, net: r.net },
      to: r.target })) }), NOTE]);

console.log(`\nAligned ${n} employees to db_bill's full component breakdown.`);
const [after]: any = await db.query(
  `SELECT COUNT(*) n, ROUND(SUM(net_salary)) net FROM salary_prep_line WHERE run_id=?`, [RUN]);
console.log(`Run total: ${after[0].n} lines, net ${inr(after[0].net)}`);
process.exit(0);
