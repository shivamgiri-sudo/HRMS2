/**
 * Backfill the UAN numbers db_bill holds and HRMS does not.
 *
 * SCOPE IS FIVE PEOPLE, AND THAT IS THE FINDING. 417 active employees have no UAN in HRMS. All
 * three db_bill sources were checked against every one of them:
 *
 *     masjclrentry        381 of 417 matched, 5 had a usable UAN
 *     his_masjsclrentry   281 matched,        3 had one (the same people)
 *     employee_master     1 matched,          0
 *
 * So the employees exist in db_bill — their UAN field is simply blank there too. This is not a
 * sync gap that can be closed; the number was never recorded in either system. 207 of the 417
 * joined since June 2026 (46 in September, 102 in August), and UAN is allotted by EPFO on first
 * PF contribution, so a recent joiner genuinely does not have one yet. That is the expected
 * state, not missing data, and it is a question for the PF team rather than a backfill.
 *
 * PROVENANCE. Values read from db_bill on 2026-09-06 (LAN-only, reached via the production
 * host). Three of the five appear in BOTH masjclrentry and his_masjsclrentry and agree exactly;
 * the other two appear in masjclrentry alone. All are 12 digits, the correct UAN length.
 *
 * SAFETY. Writes only where HRMS currently holds nothing — an existing UAN is never overwritten,
 * because a value already in HRMS was entered by someone who could see the employee's actual
 * document and db_bill is not a higher authority than that. Refuses any value that is not 12
 * digits, and refuses to assign a UAN already held by a DIFFERENT employee, which would be a
 * statutory identity collision rather than a data-entry slip.
 *
 * Idempotent. Dry-run by default; set APPLY=1 to write.
 */
const mysql = require("mysql2/promise");
require("dotenv").config();

const APPLY = process.env.APPLY === "1";
const ACTOR = "a4a4902e-6222-11f1-adb1-00155d0ab410"; // shivam.giri@teammas.in

/** employee_code -> UAN, verified against db_bill 2026-09-06. */
const UANS = [
  { code: "MAS63415", uan: "102165451231", sources: "masjclrentry + his_masjsclrentry (agree)" },
  { code: "MAS63417", uan: "101949956169", sources: "masjclrentry + his_masjsclrentry (agree)" },
  { code: "MAS63423", uan: "102253534943", sources: "masjclrentry" },
  { code: "MAS63432", uan: "101983936782", sources: "masjclrentry" },
  { code: "MAS63452", uan: "102357140495", sources: "masjclrentry + his_masjsclrentry (agree)" },
];

const UAN_RE = /^\d{12}$/;

async function main() {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    port: +(process.env.DB_PORT || 3306), connectTimeout: 20000,
  });

  const plan = [];
  const skipped = [];

  for (const row of UANS) {
    if (!UAN_RE.test(row.uan)) { skipped.push({ ...row, why: "not 12 digits" }); continue; }

    const [[emp]] = await c.query(
      `SELECT id, employee_code, CONCAT(first_name,' ',COALESCE(last_name,'')) nm, uan_number
         FROM employees WHERE employee_code = ? LIMIT 1`, [row.code]);
    if (!emp) { skipped.push({ ...row, why: "employee_code not found in HRMS" }); continue; }
    if (emp.uan_number && String(emp.uan_number).trim() !== "") {
      skipped.push({ ...row, why: `HRMS already holds ${emp.uan_number} — not overwritten` });
      continue;
    }

    // A UAN identifies one person to EPFO. The same number on two employees is a statutory
    // identity collision, not a typo to be pushed through.
    const [[clash]] = await c.query(
      `SELECT employee_code FROM employees WHERE uan_number = ? AND id <> ? LIMIT 1`,
      [row.uan, emp.id]);
    if (clash) { skipped.push({ ...row, why: `UAN already held by ${clash.employee_code}` }); continue; }

    plan.push({ ...row, id: emp.id, name: String(emp.nm || "").trim() });
  }

  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — ${UANS.length} candidate(s) from db_bill`);
  console.log(`  to write: ${plan.length}   skipped: ${skipped.length}\n`);
  if (plan.length) {
    console.table(plan.map((p) => ({ employee: p.code, name: p.name, uan: p.uan, source: p.sources })));
  }
  for (const s of skipped) console.log(`  SKIP ${s.code}: ${s.why}`);

  if (!plan.length) { console.log("\nNothing to write."); await c.end(); return; }
  if (!APPLY) { console.log("\nNo changes written. Re-run with APPLY=1."); await c.end(); return; }

  await c.beginTransaction();
  let n = 0;
  try {
    for (const p of plan) {
      // Guarded on still-empty so a concurrent edit wins rather than being clobbered.
      const [res] = await c.execute(
        `UPDATE employees SET uan_number = ?, updated_at = NOW()
          WHERE id = ? AND (uan_number IS NULL OR uan_number = '')`,
        [p.uan, p.id]);
      n += res.affectedRows;
    }
    await c.execute(
      `INSERT INTO sensitive_action_log
         (id, actor_user_id, action_type, module_key, entity_type, change_summary, acted_at, reason)
       VALUES (UUID(), ?, 'UAN_BACKFILLED_FROM_DBBILL', 'employees', 'employees', ?, NOW(), ?)`,
      [ACTOR,
       JSON.stringify({ written: n, employees: plan.map((p) => ({ code: p.code, uan: p.uan, source: p.sources })) }),
       "Backfilled UAN from db_bill (masjclrentry / his_masjsclrentry), verified 2026-09-06. " +
       "Only employees whose HRMS uan_number was empty; existing values never overwritten. " +
       "The other 412 active employees without a UAN have none in db_bill either — 207 joined " +
       "since June 2026 and are awaiting EPFO allotment."],
    );
    await c.commit();
    console.log(`\nCommitted. rows updated = ${n}`);
  } catch (e) {
    await c.rollback();
    console.error("ROLLED BACK —", e.message);
    process.exitCode = 1;
  }
  await c.end();
}

main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
