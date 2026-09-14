/**
 * Assign the capacity_viewer role to the Capacity Dashboard's real audience.
 *
 * THE RULE (owner-stated): everyone in Operations, HR and Training & Quality may see the
 * Capacity Dashboard, EXCEPT Operations staff whose designation is EXECUTIVE.
 *
 * That rule is expressed by DESIGNATION. Access is granted by ROLE. They do not line up: of the
 * 106 people in the audience, only 36 are reachable by any existing role grant. The other 70
 * hold the plain 'employee' role or none at all - the same role as the 913 Operations
 * EXECUTIVEs the rule excludes - so no grant on an existing role can admit one group without
 * admitting the other. capacity_viewer (migration 1689) exists to close exactly that gap, and
 * this script is what puts people in it.
 *
 * WHY IT IS A SCRIPT AND NOT A MIGRATION. The membership is not a fact about the schema, it is
 * a fact about who works here today. A new Team Leader joining next month belongs in the role;
 * a migration would have frozen the list on the day it was written. Re-running this picks up
 * joiners, movers and designation changes. It is idempotent: already-granted people are left
 * alone, and it never revokes.
 *
 * WHO IS EXCLUDED, AND WHY EACH IS DELIBERATE:
 *   - designation EXECUTIVE in Operations : the owner's exclusion, the whole point of the rule
 *   - already reachable by another role    : nothing to add, they can see it today
 *   - no user_id                           : no login account exists, so there is nothing to
 *                                            attach a role to. Reported, not silently dropped.
 *   - not active in db_bill                : owner's condition - masjclrentry.Status must be
 *                                            '1'. Note Status is a NUMERIC flag stored as text;
 *                                            any word in that column casts to 0 = Inactive, so
 *                                            this compares the string exactly rather than
 *                                            relying on MySQL's coercion.
 *   - absent from masjclrentry             : cannot be confirmed active, so not granted. These
 *                                            are usually joiners not yet onboarded into finance.
 *
 * Dry run by default; --apply writes. Never revokes, never touches any other role.
 *   node_modules/.bin/tsx scripts/grant-capacity-viewer.mts [--apply]
 */
import "dotenv/config";
import mysql from "mysql2/promise";
import { randomUUID } from "crypto";

const ROLE = "capacity_viewer";
const APPLY = process.argv.includes("--apply");
const GRANTOR = "a4a4902e-6222-11f1-adb1-00155d0ab410";

// Roles that already reach WFM_CAPACITY_DASHBOARD via migration 1688.
const ALREADY_REACHING = [
  "super_admin", "admin", "ceo", "hr", "wfm", "branch_wfm", "branch_head",
  "process_manager", "manager", "assistant_manager", "team_leader", "tl",
  "tq_head", "trainer", "qa",
];

const h = await mysql.createConnection({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
});
await h.execute("SET SESSION innodb_lock_wait_timeout=20");
await h.query("SET SESSION sql_mode=''");

const ph = ALREADY_REACHING.map(() => "?").join(",");
const [reachRows] = (await h.execute(
  `SELECT DISTINCT e.id FROM employees e
     JOIN user_roles ur ON ur.user_id = e.user_id AND ur.active_status = 1
    WHERE e.active_status = 1 AND ur.role_key IN (${ph})`, ALREADY_REACHING)) as any[];
const reachable = new Set((reachRows as any[]).map((r) => r.id));

const [audience] = (await h.execute(
  `SELECT e.id, e.employee_code c, e.user_id,
          COALESCE(e.full_name, CONCAT_WS(' ', e.first_name, e.last_name)) nm,
          d.dept_name dept, dm.designation_name desig
     FROM employees e
     JOIN department_master d ON d.id = e.department_id
     LEFT JOIN designation_master dm ON dm.id = e.designation_id
    WHERE e.active_status = 1
      AND ( (d.dept_name LIKE '%PERATION%' AND COALESCE(dm.designation_name,'') <> 'EXECUTIVE')
            OR d.dept_name LIKE '%HUMAN%' OR d.dept_name LIKE '%TRAINING%' )`)) as any[];

const needing = (audience as any[]).filter((a) => !reachable.has(a.id));

// db_bill confirmation.
const b = await mysql.createConnection({
  host: process.env.BILL_DB_HOST, port: Number(process.env.BILL_DB_PORT) || 3306,
  user: process.env.BILL_DB_USER, password: process.env.BILL_DB_PASSWORD, database: process.env.BILL_DB_NAME,
});
const codes = needing.map((n) => n.c);
const bph = codes.map(() => "?").join(",");
const [billRows] = (await b.execute(
  `SELECT EmpCode, Status FROM masjclrentry WHERE EmpCode IN (${bph})`, codes)) as any[];
await b.end();
const bill = new Map((billRows as any[]).map((r) => [String(r.EmpCode).trim(), String(r.Status ?? "").trim()]));

const grant: any[] = [], noLogin: any[] = [], notActive: any[] = [], notInBill: any[] = [];
for (const n of needing) {
  const st = bill.get(n.c);
  if (st === undefined) { notInBill.push(n); continue; }
  if (st !== "1") { notActive.push({ ...n, st }); continue; }
  if (!n.user_id) { noLogin.push(n); continue; }
  grant.push(n);
}

// Who already holds the role, so a re-run is a no-op for them.
let already = new Set<string>();
if (grant.length) {
  const gph = grant.map(() => "?").join(",");
  const [ex] = (await h.execute(
    `SELECT user_id FROM user_roles WHERE role_key = ? AND active_status = 1 AND user_id IN (${gph})`,
    [ROLE, ...grant.map((g) => g.user_id)])) as any[];
  already = new Set((ex as any[]).map((r) => r.user_id));
}
const toWrite = grant.filter((g) => !already.has(g.user_id));

console.log(`audience needing access: ${needing.length}`);
console.log(`  eligible to grant (active in db_bill + has login): ${grant.length}`);
console.log(`    already hold ${ROLE}: ${already.size}   to write now: ${toWrite.length}`);
console.log(`  held back - no login account : ${noLogin.length}${noLogin.length ? "  " + noLogin.map((x) => x.c).join(", ") : ""}`);
console.log(`  held back - not in masjclrentry: ${notInBill.length}${notInBill.length ? "  " + notInBill.map((x) => x.c).join(", ") : ""}`);
console.log(`  held back - db_bill not active : ${notActive.length}${notActive.length ? "  " + notActive.map((x) => `${x.c}(Status=${x.st || "blank"})`).join(", ") : ""}`);

const byD: Record<string, number> = {};
for (const g of toWrite) { const k = `${g.dept} / ${g.desig ?? "-"}`; byD[k] = (byD[k] ?? 0) + 1; }
console.log("\n  to write, by designation:");
for (const [k, v] of Object.entries(byD).sort((a, b) => b[1] - a[1])) console.log(`    ${v} x ${k}`);

if (!APPLY) { console.log("\n(dry run - pass --apply to write)"); await h.end(); process.exit(0); }
if (!toWrite.length) { console.log("\nnothing to write"); await h.end(); process.exit(0); }

await h.beginTransaction();
try {
  for (const g of toWrite) {
    const [u] = (await h.execute(
      `INSERT INTO user_roles (id, user_id, role_key, active_status, granted_by, granted_at)
       VALUES (?, ?, ?, 1, ?, NOW())
       ON DUPLICATE KEY UPDATE active_status = 1`,
      [randomUUID(), g.user_id, ROLE, GRANTOR])) as any[];
    if (!u.affectedRows) throw new Error(`${g.c}: insert affected 0 rows`);
  }
  await h.commit();
  console.log(`\nCOMMITTED - ${ROLE} granted to ${toWrite.length} users`);
} catch (e: any) {
  await h.rollback();
  console.error("ROLLED BACK:", e.message);
  await h.end();
  process.exit(1);
}

const [after] = (await h.execute(
  "SELECT COUNT(*) n FROM user_roles WHERE role_key = ? AND active_status = 1", [ROLE])) as any[];
console.log(`AFTER: ${(after as any[])[0].n} users hold ${ROLE}`);
await h.end();
process.exit(0);
