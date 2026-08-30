/**
 * Correct employee_bank_detail.account_holder_name where the name mas_hrms would print on
 * the bank payment file disagrees with the name db_bill actually credited the SAME account
 * under.
 *
 * WHY THIS FIELD AND NOT employees.full_name
 *   account_holder_name means, literally, the name on the bank account. employees.full_name
 *   is HR identity — a preferred name, a post-marriage name, a legal correction — and HR may
 *   have set it deliberately. Overwriting it to satisfy a bank file would corrupt payslips,
 *   letters and statutory filings to fix a cosmetic column. So only the bank field moves.
 *
 * WHY db_bill's NAME IS AUTHORITATIVE HERE
 *   Not because db_bill is newer — it is that for each employee below, mas_hrms and db_bill
 *   hold the SAME account number and the SAME IFSC, and db_bill credited that account on
 *   2026-07-31 under its own name. The name being written is therefore the name under which
 *   this exact account has demonstrably received salary, which is the only definition of
 *   "account holder name" that can be verified rather than asserted.
 *
 * WHAT THIS IS NOT FIXING
 *   Nothing here affects whether the money arrives. Disbursal resolves on account number and
 *   IFSC: db_bill has paid MAS49781 51 times as "DEEPANSHU BISHT" while its own AccHolder
 *   field says "DIPANSHU BISHT", and a penny-drop on MAS47142 returned nameAtBank
 *   "SANTOSH KUMAR" for employee "ASHISH RAWAT" and still deposited successfully. This is a
 *   reconciliation and audit correction so the salary sheet reads consistently — not a
 *   payment fix.
 *
 * Guards, all of which must hold per row or the row is skipped:
 *   - account number present in both systems and identical
 *   - IFSC present in both systems and identical
 *   - db_bill has at least one credit with money to that account
 *   - the resulting name is a plausible name (letters, >= 3 chars)
 *
 * Read-only unless --apply. db_bill is never written to.
 *
 *   node scripts/fix-beneficiary-name-divergence.mjs
 *   node scripts/fix-beneficiary-name-divergence.mjs --apply
 */
import mysql from "mysql2/promise";

const APPLY = process.argv.includes("--apply");
const arg = (k, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.split("=").slice(1).join("=") : d;
};
const PW = process.env.MYSQL_PWD ?? process.env.DB_PASSWORD;
if (!PW) { console.error("Set MYSQL_PWD (or DB_PASSWORD)."); process.exit(1); }

const hrms = await mysql.createConnection({
  host: arg("hrms-host", "122.184.128.90"), user: arg("user", "shivam_user"),
  password: PW, database: "mas_hrms",
});
const bill = await mysql.createConnection({
  host: arg("bill-host", "14.97.30.236"), user: arg("user", "shivam_user"),
  password: PW, database: "db_bill",
});

const norm  = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z ]/g, " ").replace(/\s+/g, " ").trim();
const dig   = (s) => String(s ?? "").replace(/\D/g, "");
const plausible = (s) => { const t = String(s ?? "").trim(); return t.length >= 3 && /[A-Za-z]/.test(t) && !/^\d+$/.test(t); };

// Every active primary bank record, with the name the file would currently print.
const [hrRows] = await hrms.execute(
  `SELECT ebd.id AS bank_id, e.employee_code,
          TRIM(e.full_name) AS hrms_name,
          TRIM(COALESCE(ebd.account_holder_name,'')) AS holder,
          CAST(ebd.account_number AS CHAR) AS acct,
          TRIM(COALESCE(ebd.ifsc_code,'')) AS ifsc
     FROM employee_bank_detail ebd
     JOIN employees e ON e.id = ebd.employee_id AND e.active_status = 1
    WHERE ebd.is_primary = 1 AND ebd.active_status = 1`
);

// Most recent db_bill credit that actually moved money, per employee.
const [payRows] = await bill.execute(
  `SELECT EmpCode, TRIM(EmpName) AS paid_name, TRIM(COALESCE(AcNo,'')) AS acno, SalDate
     FROM salary_data WHERE NetSalary > 0 AND TRIM(COALESCE(EmpName,'')) <> ''`
);
const paid = new Map();
for (const r of payRows) {
  const p = paid.get(r.EmpCode);
  if (!p || String(r.SalDate) > String(p.SalDate)) paid.set(r.EmpCode, r);
}
// IFSC from the db_bill bank master.
const [mstRows] = await bill.execute(
  `SELECT EmpCode, TRIM(COALESCE(IFSCCode,'')) AS ifsc FROM masjclrentry`
);
const billIfsc = new Map(mstRows.map((r) => [r.EmpCode, r.ifsc]));

const plan = [], skip = { agrees: 0, no_credit: 0, acct_mismatch: [], ifsc_mismatch: [], implausible: [] };

for (const h of hrRows) {
  const currentlyPrints = h.holder || h.hrms_name;   // what the export emits today
  const b = paid.get(h.employee_code);
  if (!b) { skip.no_credit++; continue; }
  if (norm(b.paid_name) === norm(currentlyPrints)) { skip.agrees++; continue; }

  const ha = dig(h.acct), ba = dig(b.acno);
  if (!ha || !ba || ha !== ba) { skip.acct_mismatch.push(h.employee_code); continue; }
  const bi = billIfsc.get(h.employee_code) ?? "";
  if (!h.ifsc || !bi || h.ifsc.toUpperCase() !== bi.toUpperCase()) { skip.ifsc_mismatch.push(h.employee_code); continue; }
  if (!plausible(b.paid_name)) { skip.implausible.push(h.employee_code); continue; }

  plan.push({ bank_id: h.bank_id, code: h.employee_code, from: currentlyPrints, to: b.paid_name });
}

console.log(`\n=== BENEFICIARY NAME DIVERGENCE ${APPLY ? "(APPLY)" : "(DRY RUN)"} ===\n`);
console.log(`  active primary bank records        ${hrRows.length}`);
console.log(`  already agree with the paid name   ${skip.agrees}`);
console.log(`  no db_bill credit (new HRMS hires) ${skip.no_credit}`);
console.log(`  skipped, account differs           ${skip.acct_mismatch.length}${skip.acct_mismatch.length ? " -> " + skip.acct_mismatch.join(",") : ""}`);
console.log(`  skipped, IFSC differs              ${skip.ifsc_mismatch.length}${skip.ifsc_mismatch.length ? " -> " + skip.ifsc_mismatch.join(",") : ""}`);
console.log(`  skipped, name implausible          ${skip.implausible.length}${skip.implausible.length ? " -> " + skip.implausible.join(",") : ""}`);
console.log(`  TO CORRECT                         ${plan.length}\n`);
for (const p of plan)
  console.log(`    ${p.code.padEnd(11)} "${p.from}"  ->  "${p.to}"`);

if (!APPLY) {
  console.log(`\n  Dry run. Re-run with --apply to write ${plan.length} row(s).\n`);
} else {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const bak = `employee_bank_detail_pre_benefix_${stamp}`;
  await hrms.execute(`CREATE TABLE \`${bak}\` AS SELECT * FROM employee_bank_detail`);
  console.log(`\n  backup table: ${bak}`);
  let n = 0;
  for (const p of plan) {
    const [r] = await hrms.execute(
      `UPDATE employee_bank_detail SET account_holder_name = ?, updated_at = NOW() WHERE id = ?`,
      [p.to, p.bank_id]
    );
    n += r.affectedRows ?? 0;
  }
  console.log(`  rows updated: ${n}\n`);
}

await hrms.end(); await bill.end();
