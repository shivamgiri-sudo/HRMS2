/**
 * Recovery: re-apply the approved leave days that were silently discarded on locked days.
 *
 * Same defect as recover-silent-noop-corrections.cjs — upsertDailyRecord writes every column as
 * `IF(is_locked = 0, VALUES(x), x)`, so on a locked day the write succeeds and changes nothing.
 * BATCH-1788525513744 (uploaded 2026-09-04 12:38): every UNLOCKED day landed, every LOCKED day
 * did not. That correlation is the tell, and the timing confirms it — the affected days were
 * locked on 2026-09-01/02, before the batch was ever uploaded, so the leave write could only
 * ever have hit an already-locked row.
 *
 * WHAT THE CORRECT END STATE IS (src/shared/halfDayLeave.ts is the authority):
 *   whole day (1.00) -> 'leave_approved', lwp 0     — the day is replaced outright
 *   half day  (0.50) -> transition from the WORKED status, never 'leave_approved':
 *                         absent/missing_punch/unreconciled -> half_day (lwp 0.5)
 *                         half_day                          -> present  (lwp 0)
 *                         present/late/leave_approved       -> REFUSED, already a full paid day
 *
 * The half-day map is duplicated here rather than imported because this is a plain .cjs script
 * and the authority is TypeScript. half-day-recovery-parity.test.ts asserts the two agree, so a
 * change to the shared rules cannot silently leave this script behind.
 *
 * GUARD: a row is only touched when its updated_at predates the leave's approval — proof the
 * transition never ran after approval. A row touched afterwards is reported and skipped.
 *
 * Idempotent: each row is matched on its exact current status, so a second run updates nothing.
 * Dry-run by default. Set APPLY=1 to write.
 */
const mysql = require("mysql2/promise");
require("dotenv").config();

const BATCH_ID = "f74969e9-f50c-454f-bd43-c6704de97704"; // BATCH-1788525513744
const BATCH_NO = "BATCH-1788525513744";
const ACTOR = "a4a4902e-6222-11f1-adb1-00155d0ab410"; // shivam.giri@teammas.in
const APPLY = process.env.APPLY === "1";

// Mirrors src/shared/halfDayLeave.ts — kept in step by half-day-recovery-parity.test.ts.
const HALF_DAY_ATTENDANCE_TRANSITION = {
  absent: "half_day",
  missing_punch: "half_day",
  unreconciled: "half_day",
  half_day: "present",
};
const HALF_DAY_ALREADY_FULL = new Set(["present", "late", "leave_approved"]);

function halfDayAttendanceTarget(existing) {
  const current = (existing ?? "").trim();
  if (!current) return "half_day";
  if (HALF_DAY_ALREADY_FULL.has(current)) return null;
  return HALF_DAY_ATTENDANCE_TRANSITION[current] ?? "half_day";
}
const halfDayLwpValue = (status) => (status === "half_day" ? 0.5 : 0);

const REASON =
  `Recovery of ${BATCH_NO}: approved leave was not applied because the day was locked and ` +
  `upsertDailyRecord's IF(is_locked=0,...) write silently no-opped. Re-applied from the ` +
  `approved leave_request. Write path fixed in commit 638c6383.`;

const SELECT_CANDIDATES = `
  SELECT l.id leave_id, l.employee_id, l.total_days, l.approved_at,
         DATE_FORMAT(l.from_date,'%Y-%m-%d') d,
         d.id adr_id, d.attendance_status cur, d.lwp_value cur_lwp, d.is_locked,
         d.updated_at adr_updated
    FROM upload_batch_row br
    JOIN leave_request l ON l.id = br.created_entity_id
    JOIN attendance_daily_record d
      ON d.employee_id = l.employee_id AND d.record_date = l.from_date
   WHERE br.upload_batch_id = ?
     AND br.created_entity_type = 'leave_request'
     AND l.status = 'approved'`;

async function main() {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: +(process.env.DB_PORT || 3306),
  });

  const [rows] = await c.query(SELECT_CANDIDATES, [BATCH_ID]);

  const plan = [];
  const skipped = [];
  for (const r of rows) {
    const whole = Number(r.total_days) === 1;
    const target = whole ? "leave_approved" : halfDayAttendanceTarget(r.cur);
    const lwp = whole ? 0 : halfDayLwpValue(target);

    if (target === null) { skipped.push({ ...r, why: "already a full paid day — nothing to add" }); continue; }
    if (r.cur === target) { skipped.push({ ...r, why: "already correct" }); continue; }
    // Only touch a row the leave demonstrably never reached.
    if (r.approved_at && r.adr_updated && new Date(r.adr_updated) > new Date(r.approved_at)) {
      skipped.push({ ...r, why: `row changed AFTER leave approval (${r.adr_updated}) — not ours to overwrite` });
      continue;
    }
    plan.push({ ...r, target, lwp });
  }

  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — ${rows.length} approved leave days in ${BATCH_NO}`);
  console.log(`  to repair: ${plan.length}   leaving alone: ${skipped.length}`);
  const byMove = {};
  for (const p of plan) {
    const k = `${Number(p.total_days) === 1 ? "whole" : "half"}: ${p.cur} -> ${p.target}`;
    byMove[k] = (byMove[k] || 0) + 1;
  }
  console.log("\n  repairs:");
  for (const [k, n] of Object.entries(byMove)) console.log(`    ${String(n).padStart(4)}  ${k}`);
  const whySkip = {};
  for (const s of skipped) whySkip[s.why.replace(/\(.*\)/, "(…)")] = (whySkip[s.why.replace(/\(.*\)/, "(…)")] || 0) + 1;
  console.log("\n  skipped:");
  for (const [k, n] of Object.entries(whySkip)) console.log(`    ${String(n).padStart(4)}  ${k}`);
  const days = plan.reduce((a, p) => a + (Number(p.total_days) === 1 ? 1 : 0.5), 0);
  console.log(`\n  days of pay restored: ${days.toFixed(1)}`);

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
                override_by           = ?,
                override_reason       = ?,
                status_change_reason  = ?,
                status_changed_by     = ?,
                status_changed_at     = NOW(),
                updated_at            = NOW()
          WHERE id = ? AND attendance_status = ?`,
        [p.target, p.lwp, ACTOR, REASON, REASON, ACTOR, p.adr_id, p.cur],
      );
      n += res.affectedRows;
    }
    await c.execute(
      `INSERT INTO sensitive_action_log
         (id, actor_user_id, action_type, module_key, entity_type, entity_id, change_summary, acted_at, reason)
       VALUES (UUID(), ?, 'LEAVE_ATTENDANCE_RECOVERED', 'leave', 'upload_batch', ?, ?, NOW(), ?)`,
      [ACTOR, BATCH_ID,
       JSON.stringify({ batch_no: BATCH_NO, rows_recovered: n, moves: byMove, days_of_pay_restored: days }),
       REASON],
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
