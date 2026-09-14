/**
 * Close out the org-chart data defects found by the 2026-08-28 audit. User-approved ("fix all").
 *
 * Three independent fixes, each guarded and each reversible from _fixall_rollback.json.
 *
 * 1. THREE EMPLOYEES POINT AT A DEAD designation_master ROW.
 *    designation_master holds duplicate names where one row is active and one is not
 *    ('Chief Executive Officer', 'DY. MANAGER', 'Team Leader'). DEEPAK KASHYAP (the CEO),
 *    AMIT KAUR and RITA DEVI point at the inactive twin, so any query joining on
 *    active_status = 1 drops their designation. Repointed to the active row of the SAME name;
 *    nobody's title changes.
 *
 * 2. A TEST ACCOUNT IS LIVE.
 *    MAS63411 "SHIVAM TEST", joined 2026-08-24, no direct reports. It is the only remaining
 *    employee with no designation, and it inflates headcount and the org chart.
 *
 * 3. THIRTY PEOPLE WHO LEFT ARE STILL MARKED ACTIVE.
 *    24 resigned + 6 terminated, every exit date between 2026-07-01 and 2026-07-11 and all in
 *    the past, none with a single direct report. The house convention is unambiguous:
 *    30,285 resigned and 493 terminated employees are all active_status = 0. These 30 are the
 *    only ones left at 1, so they still appear on the org chart and in headcount as current
 *    staff. Note they carry lowercase 'resigned' where the other 30,285 carry 'Resigned',
 *    which is the fingerprint of a different write path that skipped the deactivation step.
 *
 *    Deliberately NOT touched: anyone whose exit date is today or later, and anyone with a
 *    direct report (deactivating them would orphan their team). Neither case exists today;
 *    the guards are in the SQL so a later run cannot do it either.
 *
 * Pass --apply to write.
 */
const mysql = require("mysql2/promise");
require("dotenv").config();
const fs = require("fs");

const APPLY = process.argv.includes("--apply");

(async () => {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME, connectTimeout: 20000,
  });

  // ── 1. dead designation pointers ────────────────────────────────────────────────────────
  const [dead] = await c.query(
    `SELECT e.id, e.employee_code, TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) name,
            e.designation_id old_id, d.designation_name,
            DATE_FORMAT(e.date_of_joining,'%Y-%m-%d') doj,
            (SELECT d2.id FROM designation_master d2
              WHERE UPPER(TRIM(d2.designation_name)) = UPPER(TRIM(d.designation_name))
                AND d2.active_status = 1 LIMIT 1) new_id
       FROM employees e
       JOIN designation_master d ON d.id = e.designation_id
      WHERE e.active_status = 1 AND d.active_status <> 1`);
  const repoint = dead.filter((r) => r.new_id && r.new_id !== r.old_id);
  console.log("## 1. employees on a dead designation row");
  console.table(dead.map((r) => ({ code: r.employee_code, name: r.name, designation: r.designation_name, hasActiveTwin: r.new_id ? "yes" : "NO — cannot repoint" })));

  // ── 2. live test account ────────────────────────────────────────────────────────────────
  const [tests] = await c.query(
    `SELECT e.id, e.employee_code, TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) name
       FROM employees e
      WHERE e.active_status = 1
        AND UPPER(CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) REGEXP 'TEST|DEMO|DUMMY'
        AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.active_status=1
                         AND COALESCE(r.reporting_manager_id,r.manager_id) = e.id)`);
  console.log("## 2. live test accounts (no direct reports)");
  console.table(tests.map((t) => ({ code: t.employee_code, name: t.name })));

  // ── 3. exited but still active ──────────────────────────────────────────────────────────
  const [exited] = await c.query(
    `SELECT e.id, e.employee_code, TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) name,
            e.employment_status, DATE_FORMAT(e.date_of_exit,'%Y-%m-%d') exit_date
       FROM employees e
      WHERE e.active_status = 1
        AND e.employment_status IN ('resigned','terminated')
        AND e.date_of_exit IS NOT NULL
        AND e.date_of_exit < CURDATE()
        AND NOT EXISTS (SELECT 1 FROM employees r WHERE r.active_status=1
                         AND COALESCE(r.reporting_manager_id,r.manager_id) = e.id)`);
  console.log(`## 3. exited but still active: ${exited.length}`);
  console.table(exited.slice(0, 8).map((e) => ({ code: e.employee_code, name: e.name, status: e.employment_status, exit: e.exit_date })));
  if (exited.length > 8) console.log(`   (+${exited.length - 8} more)`);

  if (!APPLY) { console.log("\nDRY RUN — pass --apply to write."); await c.end(); process.exit(0); }

  fs.writeFileSync("_fixall_rollback.json", JSON.stringify({
    repointedDesignations: repoint.map((r) => ({ id: r.id, code: r.employee_code, previousDesignationId: r.old_id })),
    deactivatedTestAccounts: tests.map((t) => ({ id: t.id, code: t.employee_code, previousActiveStatus: 1 })),
    deactivatedExited: exited.map((e) => ({ id: e.id, code: e.employee_code, previousActiveStatus: 1 })),
  }, null, 1));

  let a = 0, b = 0, d = 0;
  for (const r of repoint) {
    const [res] = await c.execute(
      `UPDATE employees SET designation_id = ? WHERE id = ? AND designation_id = ?`,
      [r.new_id, r.id, r.old_id]);
    if (!res.affectedRows) continue;
    a++;
    await c.execute(
      `INSERT INTO employee_job_history (id, employee_id, effective_date, change_type, from_designation_id, to_designation_id, reason)
       VALUES (UUID(), ?, ?, 'designation_change', ?, ?, ?)`,
      [r.id, r.doj, r.old_id, r.new_id,
       `Repointed to the ACTIVE designation_master row for "${r.designation_name}". designation_master holds duplicate names with one row deactivated; this employee pointed at the dead twin, so joins filtering on active_status = 1 dropped their designation. Title unchanged. 2026-08-28.`]);
  }
  for (const t of tests) {
    const [res] = await c.execute(
      `UPDATE employees SET active_status = 0 WHERE id = ? AND active_status = 1`, [t.id]);
    if (res.affectedRows) b++;
  }
  for (const e of exited) {
    const [res] = await c.execute(
      `UPDATE employees SET active_status = 0 WHERE id = ? AND active_status = 1`, [e.id]);
    if (res.affectedRows) d++;
  }

  console.log(`\nrepointed designations: ${a}   test accounts deactivated: ${b}   exited deactivated: ${d}`);
  const [after] = await c.query(
    `SELECT COUNT(*) active,
            SUM(e.designation_id IS NULL) no_designation,
            SUM(COALESCE(e.reporting_manager_id,e.manager_id) IS NULL) no_manager
       FROM employees e WHERE e.active_status = 1`);
  console.log("## headcount after"); console.table(after);
  await c.end(); process.exit(0);
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
