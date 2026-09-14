/**
 * Reconcile employees.designation_id against db_bill, the payroll source of truth.
 *
 * Run:
 *   node scripts/reconcile-designations-to-dbbill.cjs            # dry run, prints what differs
 *   node scripts/reconcile-designations-to-dbbill.cjs --apply    # writes
 *
 * ── Why this exists ────────────────────────────────────────────────────────────────────────
 * Measured 2026-08-27: of 1,120 active employees, 1,082 already agreed with db_bill, 23 had no
 * db_bill record, and 15 disagreed. The 15 are drift in `employees`, not a later HR decision —
 * for 11 of them HRMS's own employee_job_history "Legacy import - initial joining record" entry
 * already carries the db_bill value, and no promotion or designation_change record anywhere
 * justifies the employees-row value. The org chart was labelling the Chairman "VICE PRESIDENT"
 * and the COO "REGIONAL MANAGER" as a result.
 *
 * ── Where the data comes from ──────────────────────────────────────────────────────────────
 * db_bill.masjclrentry is the live joining register. NOT db_bill.employee_master, whose employee
 * codes stop at MAS36038 — anyone hired since is absent from it entirely. Note the column is
 * spelled `Desgination` (no 'i' after "Des"), so an information_schema search for '%desig%'
 * silently finds nothing; that typo is why this source was missed twice.
 *
 * ── Safety ─────────────────────────────────────────────────────────────────────────────────
 *   - Derives its own comparison; takes no input file, so no employee data lives in the repo.
 *   - Only writes where an ACTIVE designation_master row already exists for the db_bill value.
 *     Nothing is created in the master.
 *   - UPDATE is guarded on the current value (`designation_id <=> ?`), so a concurrent HR edit
 *     is skipped rather than clobbered.
 *   - Writes an employee_job_history row per change, naming both values.
 *   - Leaves a rollback file listing the previous designation_id per employee.
 *
 * ── Judgement calls left to a human ────────────────────────────────────────────────────────
 * Some rows move DOWN a level, and a few recent joiners have no corroborating job history — for
 * those, db_bill is the only evidence. The dry run flags both cases; read it before applying.
 */
const mysql = require("mysql2/promise");
require("dotenv").config();
const fs = require("fs");

const APPLY = process.argv.includes("--apply");
const U = (s) => String(s ?? "").trim().toUpperCase().replace(/\s+/g, " ");
const ROLLBACK = "designation-reconcile-rollback.json";

async function connect(cfg, label) {
  for (let i = 1; i <= 10; i++) {
    try { return await mysql.createConnection(cfg); }
    catch (e) {
      if (i === 10) throw e;
      console.log(`  ${label} connect failed (${e.message}); retry ${i}/9 in 10s`);
      await new Promise((r) => setTimeout(r, 10000));
    }
  }
}

(async () => {
  const h = await connect({
    host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME, connectTimeout: 20000,
  }, "mas_hrms");

  const [emp] = await h.query(
    `SELECT e.id, e.employee_code, TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) name,
            e.designation_id, d.designation_name,
            DATE_FORMAT(e.date_of_joining,'%Y-%m-%d') doj
       FROM employees e
       LEFT JOIN designation_master d ON d.id = e.designation_id
      WHERE e.active_status = 1`);
  const [dm] = await h.query(
    `SELECT id, designation_name FROM designation_master WHERE active_status = 1`);
  const dmBy = new Map(dm.map((d) => [U(d.designation_name), d]));

  const b = await connect({
    host: process.env.BILL_DB_HOST, port: process.env.BILL_DB_PORT, user: process.env.BILL_DB_USER,
    password: process.env.BILL_DB_PASSWORD, database: process.env.BILL_DB_NAME, connectTimeout: 20000,
  }, "db_bill");
  const codes = emp.map((e) => e.employee_code);
  const [jc] = await b.query(
    `SELECT EmpCode, Desgination FROM masjclrentry WHERE EmpCode IN (${codes.map(() => "?").join(",")})`,
    codes);
  await b.end();

  const bill = new Map();
  for (const r of jc) {
    const v = String(r.Desgination ?? "").trim();
    if (v && !bill.has(U(r.EmpCode))) bill.set(U(r.EmpCode), v);
  }

  // Which of these already have a legacy joining record agreeing with db_bill?
  const [hist] = await h.query(
    `SELECT j.employee_id, td.designation_name
       FROM employee_job_history j
       JOIN designation_master td ON td.id = j.to_designation_id
      WHERE j.change_type = 'initial_assignment'`);
  const histBy = new Map();
  for (const r of hist) if (!histBy.has(r.employee_id)) histBy.set(r.employee_id, r.designation_name);

  let agree = 0, noBill = 0, noMaster = 0;
  const plan = [];
  for (const e of emp) {
    const v = bill.get(U(e.employee_code));
    if (!v) { noBill++; continue; }
    if (U(v) === U(e.designation_name)) { agree++; continue; }
    const target = dmBy.get(U(v));
    if (!target) { noMaster++; console.log(`  no active master row for "${v}" (${e.employee_code}) — skipped`); continue; }
    if (target.id === e.designation_id) continue;
    plan.push({
      id: e.id, code: e.employee_code, name: e.name, doj: e.doj,
      fromId: e.designation_id, from: e.designation_name ?? "(none)",
      toId: target.id, to: target.designation_name,
      corroborated: U(histBy.get(e.id) ?? "") === U(v),
    });
  }

  console.log(JSON.stringify({ active: emp.length, agree, disagree: plan.length, noDbBillRow: noBill, noMasterRow: noMaster }));
  console.table(plan.map((p) => ({
    code: p.code, name: p.name, from: p.from, to: p.to,
    joiningRecordAgrees: p.corroborated ? "yes" : "NO — db_bill is the only evidence",
  })));

  if (!APPLY) { console.log("\nDRY RUN — pass --apply to write."); await h.end(); process.exit(0); }

  fs.writeFileSync(ROLLBACK, JSON.stringify(
    plan.map((p) => ({ id: p.id, code: p.code, previousDesignationId: p.fromId, previousName: p.from })), null, 1));

  let n = 0;
  for (const p of plan) {
    const [res] = await h.execute(
      `UPDATE employees SET designation_id = ? WHERE id = ? AND designation_id <=> ?`,
      [p.toId, p.id, p.fromId]);
    if (!res.affectedRows) { console.log(`  skipped ${p.code} — value changed underneath us`); continue; }
    n++;
    await h.execute(
      `INSERT INTO employee_job_history
         (id, employee_id, effective_date, change_type, from_designation_id, to_designation_id, reason)
       VALUES (UUID(), ?, ?, 'designation_change', ?, ?, ?)`,
      [p.id, p.doj, p.fromId, p.toId,
       `Reconciled to db_bill.masjclrentry: "${p.from}" -> "${p.to}". The employees row had drifted from the legacy joining record.`]);
  }
  console.log(`\nreconciled: ${n}   rollback written to ${ROLLBACK}`);
  await h.end(); process.exit(0);
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
