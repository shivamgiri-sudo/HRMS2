/**
 * Recovery: re-apply the attendance corrections that were approved but silently discarded.
 *
 * WHAT HAPPENED. upsertDailyRecord writes every column as `IF(is_locked = 0, VALUES(x), x)`.
 * On a locked day that statement succeeds and changes nothing. reviewRegularization therefore
 * ran to completion, stamped the regularization `approved`, and the correction evaporated.
 * BATCH-1788287542227: 916 approved, 809 changed nothing (660 half_day, 149 absent).
 * The write path is fixed (commit 638c6383); this script repairs the rows already lost.
 *
 * NO ARREARS ARE OWED. August 2026 payroll was never actually run — salary_prep_run
 * 5035d780 is a 3-line stub (total_employees=0, no payslips, no bank transfers) that carries
 * status FINALIZED. Nobody has been paid for August, so correcting the attendance now is
 * sufficient: the live engine reads attendance_status regardless of is_locked, so a properly
 * executed August run will pay these days correctly.
 *
 * Idempotent: each row is matched on its exact current status, so a second run updates nothing.
 * Dry-run by default. Set APPLY=1 to write.
 *
 * Run: node scripts/recover-silent-noop-corrections.cjs          (dry run)
 *      APPLY=1 node scripts/recover-silent-noop-corrections.cjs  (write)
 */
const mysql = require("mysql2/promise");
require("dotenv").config();

const BATCH_ID = "c94ed8fd-1aaf-4e36-a19b-00f9b48f4e81"; // BATCH-1788287542227
const BATCH_NO = "BATCH-1788287542227";
const ACTOR = "a4a4902e-6222-11f1-adb1-00155d0ab410"; // shivam.giri@teammas.in
const APPLY = process.env.APPLY === "1";

const REASON =
  `Recovery of ${BATCH_NO}: correction was approved but the write was a silent no-op on a ` +
  `locked day (upsertDailyRecord IF(is_locked=0,...)). Re-applied from the approved ` +
  `attendance_regularization row. Write path fixed in commit 638c6383.`;

// The lost corrections, matched on their exact current state so this cannot double-apply.
const SELECT_LOST = `
  SELECT r.id reg_id, r.employee_id, DATE_FORMAT(r.session_date,'%Y-%m-%d') d,
         d.id adr_id, d.attendance_status cur, d.lwp_value cur_lwp, r.new_status target
    FROM upload_batch_row br
    JOIN attendance_regularization r ON r.id = br.created_entity_id
    JOIN attendance_daily_record d
      ON d.employee_id = r.employee_id AND d.record_date = r.session_date
   WHERE br.upload_batch_id = ?
     AND br.created_entity_type = 'attendance_regularization'
     AND r.status = 'approved'
     AND r.new_status = 'present'
     AND (d.regularization_id IS NULL OR d.regularization_id <> r.id)
     AND d.attendance_status IN ('half_day','absent')`;

async function main() {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: +(process.env.DB_PORT || 3306),
  });

  const [lost] = await c.query(SELECT_LOST, [BATCH_ID]);
  const half = lost.filter((r) => r.cur === "half_day").length;
  const abs = lost.filter((r) => r.cur === "absent").length;
  const emps = new Set(lost.map((r) => r.employee_id)).size;
  console.log(
    `${APPLY ? "APPLY" : "DRY RUN"} — ${lost.length} lost corrections ` +
      `(${half} half_day, ${abs} absent) across ${emps} employees`,
  );
  console.log(`days of pay restored: ${(half * 0.5 + abs * 1.0).toFixed(1)}`);
  console.table(
    lost.slice(0, 5).map((r) => ({
      emp: r.employee_id.slice(0, 8),
      date: r.d,
      from: r.cur,
      lwp: r.cur_lwp,
      to: r.target,
    })),
  );

  if (!lost.length) {
    console.log("Nothing to recover.");
    await c.end();
    return;
  }
  if (!APPLY) {
    console.log("\nNo changes written. Re-run with APPLY=1 to write.");
    await c.end();
    return;
  }

  await c.beginTransaction();
  let n = 0;
  try {
    for (const r of lost) {
      const [res] = await c.execute(
        `UPDATE attendance_daily_record
            SET old_attendance_status = attendance_status,
                old_lwp_value         = lwp_value,
                attendance_status     = 'present',
                lwp_value             = 0.00,
                regularization_id     = ?,
                override_by           = ?,
                override_reason       = ?,
                status_change_reason  = ?,
                status_changed_by     = ?,
                status_changed_at     = NOW(),
                updated_at            = NOW()
          WHERE id = ? AND attendance_status = ?`,
        [r.reg_id, ACTOR, REASON, REASON, ACTOR, r.adr_id, r.cur],
      );
      n += res.affectedRows;
    }
    await c.execute(
      `INSERT INTO sensitive_action_log
         (id, actor_user_id, action_type, module_key, entity_type, entity_id, change_summary, acted_at, reason)
       VALUES (UUID(), ?, 'ATTENDANCE_CORRECTION_RECOVERED', 'wfm', 'upload_batch', ?, ?, NOW(), ?)`,
      [
        ACTOR,
        BATCH_ID,
        JSON.stringify({
          batch_no: BATCH_NO,
          rows_recovered: n,
          half_day_to_present: half,
          absent_to_present: abs,
          employees: emps,
          days_of_pay_restored: half * 0.5 + abs * 1.0,
        }),
        REASON,
      ],
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

main().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
