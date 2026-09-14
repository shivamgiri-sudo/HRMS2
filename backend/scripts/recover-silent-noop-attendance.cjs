/**
 * Generalised recovery: re-apply every approved correction the silent no-op discarded.
 *
 * The two batch-specific scripts beside this one (recover-silent-noop-corrections.cjs,
 * recover-silent-noop-leave.cjs) repaired the two batches we found by hand. This one repairs
 * whatever verify-attendance-corrections-applied.cjs reports as CONFIRMED, from any source —
 * because the defect was never batch-specific, only our discovery of it was. Running the detector
 * first found 186 further victims outside both batches.
 *
 * SCOPE. Only the CONFIRMED bucket: approved, diverged, and sitting on a locked day the
 * correction does not own. That is the signature of `IF(is_locked = 0, VALUES(x), x)` declining
 * a write silently. Days that were re-graded AFTER their approval are deliberately excluded —
 * a later re-grade is a different question with a different answer, and overwriting it here
 * would be guessing.
 *
 * Idempotent: each row is matched on its exact current status, so a second run updates nothing.
 * Dry-run by default. Set APPLY=1 to write.
 *
 * Run: node scripts/recover-silent-noop-attendance.cjs [--days=90]
 *      APPLY=1 node scripts/recover-silent-noop-attendance.cjs [--days=90]
 */
const mysql = require("mysql2/promise");
require("dotenv").config();

const ACTOR = "a4a4902e-6222-11f1-adb1-00155d0ab410"; // shivam.giri@teammas.in
const APPLY = process.env.APPLY === "1";
const argDays = Number((process.argv.find((a) => a.startsWith("--days=")) || "").split("=")[1]) || 90;

const LEGACY = { P: "present", A: "absent", HD: "half_day" };
const UNMAPPED = ["OD", "DH", "T"];
const CALENDAR = ["holiday", "week_off", "week_off_worked"];
// lwp_value must never disagree with the status it belongs to.
const LWP_FOR = { present: 0, late: 0, leave_approved: 0, half_day: 0.5, absent: 1 };

const REASON =
  "Recovery: an approved correction was discarded because the day was locked and the " +
  "IF(is_locked=0,...) write silently no-opped. Re-applied from the approved " +
  "attendance_regularization row. Write path fixed in commit 638c6383; " +
  "shared/attendanceLockGuard.ts now refuses instead of discarding.";

async function main() {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    port: +(process.env.DB_PORT || 3306),
  });

  const [rows] = await c.query(`
    SELECT r.id reg_id, r.employee_id, DATE_FORMAT(r.session_date,'%Y-%m-%d') d,
           COALESCE(r.requested_status, r.new_status) wanted_raw,
           dr.id adr_id, dr.attendance_status got, dr.lwp_value got_lwp,
           dr.regularization_id, r.reviewed_at, dr.updated_at
      FROM attendance_regularization r
      JOIN attendance_daily_record dr
        ON dr.employee_id = r.employee_id AND dr.record_date = r.session_date
     WHERE r.status = 'approved'
       AND r.session_date >= DATE_SUB(CURDATE(), INTERVAL ${argDays} DAY)
       AND dr.is_locked = 1
       AND (dr.regularization_id IS NULL OR dr.regularization_id <> r.id)
       AND COALESCE(r.requested_status, r.new_status) IS NOT NULL
       AND COALESCE(r.requested_status, r.new_status) NOT IN (${UNMAPPED.map((s) => `'${s}'`).join(",")})
       AND dr.attendance_status NOT IN (${CALENDAR.map((s) => `'${s}'`).join(",")})`);

  const plan = [];
  for (const r of rows) {
    const wanted = LEGACY[r.wanted_raw] ?? r.wanted_raw;
    if (wanted === r.got) continue;
    if (!(wanted in LWP_FOR)) continue; // never write a status whose pay value we cannot state
    plan.push({ ...r, wanted, lwp: LWP_FOR[wanted] });
  }

  const moves = {};
  for (const p of plan) {
    const k = `${p.got} -> ${p.wanted}`;
    moves[k] = (moves[k] || 0) + 1;
  }
  // Direction matters to the person being paid, so state it rather than burying it in a total.
  const paysMore = plan.filter((p) => LWP_FOR[p.got] > p.lwp).length;
  const paysLess = plan.filter((p) => LWP_FOR[p.got] < p.lwp).length;

  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — ${plan.length} silently discarded corrections ` +
    `in the last ${argDays} days`);
  console.log("\n  moves:");
  for (const [k, n] of Object.entries(moves).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(4)}  ${k}`);
  }
  console.log(`\n  increases pay for ${paysMore}, reduces pay for ${paysLess} ` +
    `(a correction may legitimately mark someone absent)`);

  if (!plan.length) { console.log("\nNothing to recover."); await c.end(); return; }
  if (!APPLY) { console.log("\nNo changes written. Re-run with APPLY=1 to write."); await c.end(); return; }

  await c.beginTransaction();
  let n = 0;
  try {
    for (const p of plan) {
      const [res] = await c.execute(
        `UPDATE attendance_daily_record
            SET old_attendance_status = attendance_status,
                old_lwp_value         = lwp_value,
                attendance_status     = ?,
                lwp_value             = ?,
                regularization_id     = ?,
                override_by           = ?,
                override_reason       = ?,
                status_change_reason  = ?,
                status_changed_by     = ?,
                status_changed_at     = NOW(),
                updated_at            = NOW()
          WHERE id = ? AND attendance_status = ?`,
        [p.wanted, p.lwp, p.reg_id, ACTOR, REASON, REASON, ACTOR, p.adr_id, p.got],
      );
      n += res.affectedRows;
    }
    await c.execute(
      `INSERT INTO sensitive_action_log
         (id, actor_user_id, action_type, module_key, entity_type, entity_id, change_summary, acted_at, reason)
       VALUES (UUID(), ?, 'ATTENDANCE_CORRECTION_RECOVERED', 'wfm', 'attendance_daily_record', NULL, ?, NOW(), ?)`,
      [ACTOR, JSON.stringify({ scope: `last ${argDays} days`, rows_recovered: n, moves, paysMore, paysLess }), REASON],
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
