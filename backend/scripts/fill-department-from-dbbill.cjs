/**
 * Fill employees.department_id from db_bill.masjclrentry.Dept where it is missing.
 * User-approved 2026-08-28 ("fix department and process").
 *
 * DEPARTMENT is recoverable: masjclrentry.Dept is populated for 75 of 75 of the affected
 * employees (74 OPERATIONS, 1 INFORMATION TECHNOLOGY) and every value maps to an active
 * department_master row.
 *
 * PROCESS IS NOT, and this script deliberately does not touch it. Checked every column in
 * masjclrentry that could plausibly carry it, for the 75 active employees with no process:
 *
 *     Process      0 / 75 populated
 *     ClientName   0 / 75 populated
 *     Stream       0 / 75 populated
 *     Profile     75 / 75 populated — but only VOICE (46) / NON-VOICE (29), a work type,
 *                                     not a client process; 0 of 75 map to process_master
 *     CostCenter  75 / 75 populated — e.g. 'BSS/BO/NOIDA-2/576'; encodes business line and
 *                                     location, not process, and cost centre is already known
 *                                     not to be a process proxy in this platform
 *
 * So process has to come from HR or from whoever ran the imports. Inventing one would attach
 * people to the wrong client, which drives P&L allocation and client-portal headcount.
 *
 * Pass --apply to write.
 */
const mysql = require("mysql2/promise");
require("dotenv").config();
const fs = require("fs");

const APPLY = process.argv.includes("--apply");
const U = (s) => String(s ?? "").trim().toUpperCase().replace(/\s+/g, " ");

(async () => {
  const h = await mysql.createConnection({
    host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME, connectTimeout: 20000,
  });
  const [gaps] = await h.query(
    `SELECT e.id, e.employee_code, TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) name,
            DATE_FORMAT(e.date_of_joining,'%Y-%m-%d') doj
       FROM employees e WHERE e.active_status = 1 AND e.department_id IS NULL`);
  const [dept] = await h.query(`SELECT id, dept_name FROM department_master WHERE active_status = 1`);
  const deptBy = new Map(dept.map((d) => [U(d.dept_name), d]));
  console.log(`active employees with no department: ${gaps.length}`);

  const b = await mysql.createConnection({
    host: process.env.BILL_DB_HOST, port: process.env.BILL_DB_PORT, user: process.env.BILL_DB_USER,
    password: process.env.BILL_DB_PASSWORD, database: process.env.BILL_DB_NAME, connectTimeout: 20000,
  });
  const codes = gaps.map((g) => g.employee_code);
  const [jc] = await b.query(
    `SELECT EmpCode, Dept FROM masjclrentry WHERE EmpCode IN (${codes.map(() => "?").join(",")})`, codes);
  await b.end();
  const bill = new Map();
  for (const r of jc) { const v = String(r.Dept ?? "").trim(); if (v && !bill.has(U(r.EmpCode))) bill.set(U(r.EmpCode), v); }

  const plan = [], unresolved = [];
  for (const g of gaps) {
    const raw = bill.get(U(g.employee_code));
    if (!raw) { unresolved.push({ code: g.employee_code, name: g.name, why: "no db_bill Dept value" }); continue; }
    const m = deptBy.get(U(raw));
    if (!m) { unresolved.push({ code: g.employee_code, name: g.name, why: `"${raw}" has no department_master row` }); continue; }
    plan.push({ ...g, deptId: m.id, deptName: m.dept_name, raw });
  }

  const spread = new Map();
  for (const p of plan) spread.set(p.deptName, (spread.get(p.deptName) ?? 0) + 1);
  console.log(`resolvable: ${plan.length}   unresolved: ${unresolved.length}`);
  console.table([...spread.entries()].map(([department, n]) => ({ department, n })));
  if (unresolved.length) { console.log("## unresolved"); console.table(unresolved); }

  if (!APPLY) { console.log("\nDRY RUN — pass --apply to write."); await h.end(); process.exit(0); }

  fs.writeFileSync("department-fill-rollback.json", JSON.stringify(
    plan.map((p) => ({ id: p.id, code: p.employee_code, previousDepartmentId: null })), null, 1));

  let n = 0;
  for (const p of plan) {
    const [res] = await h.execute(
      `UPDATE employees SET department_id = ? WHERE id = ? AND department_id IS NULL`, [p.deptId, p.id]);
    if (!res.affectedRows) continue;
    n++;
    await h.execute(
      `INSERT INTO employee_job_history
         (id, employee_id, effective_date, change_type, to_department_id, reason)
       VALUES (UUID(), ?, ?, 'department_change', ?, ?)`,
      [p.id, p.doj, p.deptId,
       `Department not captured at import; sourced from db_bill.masjclrentry.Dept (value "${p.raw}") matched on employee_code. 2026-08-28, user-approved.`]);
  }
  const [left] = await h.query(
    `SELECT COUNT(*) active, SUM(department_id IS NULL) no_department, SUM(process_id IS NULL) no_process
       FROM employees WHERE active_status = 1`);
  console.log(`\nfilled: ${n}`);
  console.table(left);
  await h.end(); process.exit(0);
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
