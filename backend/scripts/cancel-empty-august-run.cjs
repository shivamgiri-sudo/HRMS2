/**
 * Cancel the August 2026 payroll run that never ran, so the month can be run for real.
 *
 * salary_prep_run 5035d780 carries status FINALIZED while having computed nobody's pay:
 * total_employees = 0, three salary lines against July's 1,371, no payslips generated, no bank
 * transfers initiated, validation_status still 'pending', and no approved_by / closed_by /
 * disbursed_at. It has the label of a completed run with none of the substance.
 *
 * It is not harmless. createRun() refuses a second company run for a month, so this empty row
 * blocks August from ever being run properly, and its accompanying freeze is what locked 4,176
 * attendance days against figures that do not exist.
 *
 * CANCELLED, NOT DELETED. Deleting the row would erase the evidence that it existed, which is
 * precisely what anyone auditing the month would want to see. 'cancelled' is already in this
 * codebase's status vocabulary (LOCK_TERMINAL_STATUSES), and createRun now ignores voided runs
 * when checking for a duplicate — so cancelling frees the month while keeping the record.
 *
 * THE GUARD. This refuses outright if the run shows any sign of having actually paid anyone:
 * more than a handful of salary lines, any payslip generated, any bank transfer initiated, or a
 * disbursed_at. Cancelling a run that paid people would orphan real payments, and no
 * convenience is worth that risk.
 *
 * Idempotent. Dry-run by default; set APPLY=1 to write.
 */
const mysql = require("mysql2/promise");
require("dotenv").config();

const RUN_ID = "5035d780-6cb4-4bb6-a0e3-3f282fed7575";
const ACTOR = "a4a4902e-6222-11f1-adb1-00155d0ab410"; // shivam.giri@teammas.in
const APPLY = process.env.APPLY === "1";

/** Above this many salary lines it is not a stub, whatever its counters say. */
const MAX_STUB_LINES = 10;

const REASON =
  "Cancelled: this run was marked FINALIZED without ever having been executed — total_employees=0, " +
  "3 salary lines against July's 1,371, no payslips generated, no bank transfers initiated, " +
  "validation_status 'pending', no approver, no disburser. It paid nobody, and while it existed it " +
  "blocked a real August 2026 run and its freeze locked 4,176 attendance days against figures that " +
  "do not exist. Retained rather than deleted so the record of it survives.";

async function main() {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    port: +(process.env.DB_PORT || 3306),
  });

  const [[run]] = await c.query(
    `SELECT r.id, r.run_month, r.status, r.scope_kind, r.total_employees, r.disbursed_at,
            (SELECT COUNT(*) FROM salary_prep_line l WHERE l.run_id = r.id) lines_n,
            (SELECT COALESCE(SUM(payslip_generated),0) FROM salary_prep_line l WHERE l.run_id = r.id) payslips,
            (SELECT COALESCE(SUM(bank_transfer_initiated),0) FROM salary_prep_line l WHERE l.run_id = r.id) transfers
       FROM salary_prep_run r WHERE r.id = ?`, [RUN_ID]);

  if (!run) { console.error(`Run ${RUN_ID} not found.`); await c.end(); process.exitCode = 1; return; }

  console.log(`run ${run.run_month}  status=${run.status}  scope=${run.scope_kind}`);
  console.log(`  salary lines=${run.lines_n}  total_employees=${run.total_employees}`);
  console.log(`  payslips generated=${run.payslips}  bank transfers initiated=${run.transfers}`);
  console.log(`  disbursed_at=${run.disbursed_at ?? "(never)"}`);

  // Refuse on any sign this run actually paid somebody.
  const reasons = [];
  if (Number(run.lines_n) > MAX_STUB_LINES) reasons.push(`${run.lines_n} salary lines (> ${MAX_STUB_LINES})`);
  if (Number(run.payslips) > 0) reasons.push(`${run.payslips} payslip(s) generated`);
  if (Number(run.transfers) > 0) reasons.push(`${run.transfers} bank transfer(s) initiated`);
  if (run.disbursed_at) reasons.push(`disbursed_at is set (${run.disbursed_at})`);
  if (reasons.length) {
    console.error(`\nREFUSING to cancel — this run shows signs of having paid people:\n  - ${reasons.join("\n  - ")}`);
    console.error(`Cancelling it would orphan real payments. Investigate before doing anything else.`);
    await c.end();
    process.exitCode = 1;
    return;
  }

  if (String(run.status).toLowerCase() === "cancelled") {
    console.log("\nAlready cancelled — nothing to do.");
    await c.end();
    return;
  }

  console.log(`\n${APPLY ? "APPLY" : "DRY RUN"} — would set status 'cancelled' and record the reason.`);
  if (!APPLY) { console.log("No changes written. Re-run with APPLY=1."); await c.end(); return; }

  await c.beginTransaction();
  try {
    const [res] = await c.execute(
      `UPDATE salary_prep_run
          SET status = 'cancelled', rejected_by = ?, rejected_at = NOW(),
              rejection_reason = ?, updated_at = NOW()
        WHERE id = ? AND LOWER(TRIM(COALESCE(status,''))) <> 'cancelled'`,
      [ACTOR, REASON, RUN_ID],
    );
    await c.execute(
      `INSERT INTO sensitive_action_log
         (id, actor_user_id, action_type, module_key, entity_type, entity_id, change_summary, acted_at, reason)
       VALUES (UUID(), ?, 'PAYROLL_RUN_CANCELLED', 'payroll', 'salary_prep_run', ?, ?, NOW(), ?)`,
      [ACTOR, RUN_ID,
       JSON.stringify({ run_month: run.run_month, previous_status: run.status, salary_lines: Number(run.lines_n),
                        total_employees: Number(run.total_employees), payslips: Number(run.payslips),
                        bank_transfers: Number(run.transfers) }),
       REASON],
    );
    await c.commit();
    console.log(`\nCommitted. rows updated = ${res.affectedRows}`);
    console.log(`August 2026 can now be created as a real company run.`);
  } catch (e) {
    await c.rollback();
    console.error("ROLLED BACK —", e.message);
    process.exitCode = 1;
  }
  await c.end();
}

main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
