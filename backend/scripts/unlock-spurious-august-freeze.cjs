/**
 * Unlock the August 2026 attendance days that were frozen by a payroll run that never ran.
 *
 * WHY THEY ARE LOCKED AT ALL. salary_prep_run 5035d780 carries status FINALIZED but is a stub:
 * total_employees = 0, three salary lines, no payslips, no bank transfers, validation_status
 * 'pending', and no approved_by/closed_by/disbursed_at. Nobody was paid for August. The freeze
 * that accompanies a finalised month still set is_locked = 1 across the month.
 *
 * WHY THAT BLOCKS EVERYTHING. A locked day cannot be corrected: every writer guards its columns
 * with `IF(is_locked = 0, VALUES(x), x)`. Until commit 638c6383 that failed silently and
 * discarded the correction; now it refuses loudly, which is correct but leaves attendance
 * un-finalisable while the locks remain. The locks are the actual blocker, and they are
 * protecting a run that has no figures to protect.
 *
 * WHAT IS DELIBERATELY NOT UNLOCKED:
 *
 *   - Days carrying a correction (override_by or regularization_id set). `is_locked = 1` on an
 *     owned row is not a payroll freeze — it is how a human correction survives the nightly
 *     re-grade (see attendance-apr-bulk.routes.ts). Unlocking those would let the engine
 *     overwrite the very corrections we just spent this exercise restoring.
 *   - The 3 employees who DO have a salary line in that run. Their days were consumed by a
 *     payroll figure that exists, however small, so they are not ours to reopen here.
 *   - Any month other than August 2026.
 *
 * Idempotent (already-unlocked rows do not match). Dry-run by default. Set APPLY=1 to write.
 */
const mysql = require("mysql2/promise");
require("dotenv").config();

const RUN_ID = "5035d780-6cb4-4bb6-a0e3-3f282fed7575"; // the 2026-08 stub run
const MONTH_START = "2026-08-01";
const MONTH_END = "2026-08-31";
const ACTOR = "a4a4902e-6222-11f1-adb1-00155d0ab410"; // shivam.giri@teammas.in
const APPLY = process.env.APPLY === "1";

const REASON =
  "Unlocking a freeze with no payroll behind it: salary_prep_run 5035d780 (2026-08) is marked " +
  "FINALIZED but computed nobody's pay (total_employees=0, 3 lines, no payslips, no bank " +
  "transfers). The lock was blocking attendance correction and finalisation for the month. " +
  "Corrections and employees carrying a real salary line are excluded and stay locked.";

/** The scope, written once so the count, the preview and the update cannot disagree. */
const SCOPE = `
      FROM attendance_daily_record d
     WHERE d.record_date BETWEEN ? AND ?
       AND d.is_locked = 1
       AND d.override_by IS NULL
       AND d.regularization_id IS NULL
       AND NOT EXISTS (
             SELECT 1 FROM salary_prep_line l
              WHERE l.run_id = ? AND l.employee_id = d.employee_id)`;
const PARAMS = [MONTH_START, MONTH_END, RUN_ID];

async function main() {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    port: +(process.env.DB_PORT || 3306),
  });

  // Refuse to run if the premise stopped being true — if that run ever gains real salary lines,
  // its freeze is legitimate and none of this applies.
  const [[run]] = await c.query(
    `SELECT status, total_employees, (SELECT COUNT(*) FROM salary_prep_line WHERE run_id = ?) lines_n
       FROM salary_prep_run WHERE id = ?`, [RUN_ID, RUN_ID]);
  console.log(`run 2026-08: status=${run.status} total_employees=${run.total_employees} lines=${run.lines_n}`);
  if (Number(run.lines_n) > 10) {
    console.error(`REFUSING: that run now has ${run.lines_n} salary lines. It is no longer a stub, ` +
      `so its freeze may be protecting real figures. Re-check before unlocking anything.`);
    await c.end();
    process.exitCode = 1;
    return;
  }

  const [[t]] = await c.query(
    `SELECT COUNT(*) days, COUNT(DISTINCT d.employee_id) emps ${SCOPE}`, PARAMS);
  const [byStatus] = await c.query(
    `SELECT d.attendance_status s, COUNT(*) n ${SCOPE} GROUP BY 1 ORDER BY n DESC`, PARAMS);

  console.log(`\n${APPLY ? "APPLY" : "DRY RUN"} — unlocking ${t.days} day(s) across ${t.emps} employee(s)`);
  console.table(byStatus);

  // Stated explicitly, because "what it will NOT touch" is the safety property here.
  const [[kept]] = await c.query(
    `SELECT COUNT(*) n FROM attendance_daily_record
      WHERE record_date BETWEEN ? AND ? AND is_locked = 1
        AND (override_by IS NOT NULL OR regularization_id IS NOT NULL)`, [MONTH_START, MONTH_END]);
  console.log(`  staying locked — carry a correction: ${kept.n}`);

  if (!t.days) { console.log("\nNothing to unlock."); await c.end(); return; }
  if (!APPLY) { console.log("\nNo changes written. Re-run with APPLY=1 to write."); await c.end(); return; }

  await c.beginTransaction();
  try {
    // Read the ids, then update by id.
    //
    // MySQL will not let an UPDATE read the table it is writing from a subquery, and the first
    // version of this script tried to alias around that by rewriting `d.` to `d2.` in the shared
    // scope. That produced `SELECT d2.id FROM attendance_daily_record d` — the alias itself has
    // no dot, so it was never rewritten — and failed with "Unknown column 'd2.id'". The dry run
    // does not exercise the UPDATE, so nothing caught it until it ran against production. Two
    // plain statements have no such trap and read the same as the count above.
    const [idRows] = await c.query(`SELECT d.id ${SCOPE}`, PARAMS);
    const ids = idRows.map((r) => r.id);

    let affected = 0;
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      // `AND is_locked = 1` keeps this idempotent and makes the count report real changes.
      const [res] = await c.query(
        `UPDATE attendance_daily_record SET is_locked = 0, updated_at = NOW()
          WHERE id IN (${chunk.map(() => "?").join(",")}) AND is_locked = 1`,
        chunk,
      );
      affected += res.affectedRows;
    }
    const res = { affectedRows: affected };

    await c.execute(
      `INSERT INTO sensitive_action_log
         (id, actor_user_id, action_type, module_key, entity_type, entity_id, change_summary, acted_at, reason)
       VALUES (UUID(), ?, 'ATTENDANCE_RECORD_UNLOCKED', 'wfm', 'salary_prep_run', ?, ?, NOW(), ?)`,
      [ACTOR, RUN_ID,
       JSON.stringify({ month: "2026-08", days_unlocked: res.affectedRows, employees: t.emps,
                        kept_locked_corrections: kept.n, run_id: RUN_ID }),
       REASON],
    );
    await c.commit();
    console.log(`\nCommitted. days unlocked = ${res.affectedRows}`);
  } catch (e) {
    await c.rollback();
    console.error("ROLLED BACK —", e.message);
    process.exitCode = 1;
  }
  await c.end();
}

main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
