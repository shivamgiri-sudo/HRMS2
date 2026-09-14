/**
 * Detector: approved attendance changes that never reached the attendance record.
 *
 * WHY THIS EXISTS. Fixing the two known write paths (wfm.service.ts, leave.service.ts) stops the
 * two bugs we found. It does not stop the CLASS. attendance_daily_record is written from several
 * places, each guarding its columns with `IF(is_locked = 0, VALUES(x), x)` — a statement that
 * succeeds and changes nothing on a locked day. Any writer that forgets to check first fails
 * silently and indistinguishably from success, which is how 514.5 days of pay sat lost for weeks.
 *
 * So this checks the OUTCOME rather than the code path: whatever wrote the day, does the record
 * now agree with what was approved? A divergence is reported no matter which writer caused it,
 * including writers that do not exist yet.
 *
 * WHICH COLUMN. `requested_status` is the canonical vocabulary (present/absent/half_day, 54 nulls
 * in 133k rows). `new_status` mixes it with legacy import codes (P/A/HD/OD/DH/T), so comparing
 * that column directly reports ~950 "P is not present" false positives. Legacy codes are still
 * normalised below for the rows where requested_status is absent.
 *
 * WHAT IT DOES NOT CLAIM. A day that changed AFTER its approval was probably re-graded by the
 * attendance engine (a COSEC re-sync, an APR import) rather than silently dropped. That is a
 * different question with a different answer, so it is counted separately rather than folded in.
 * Only `confirmed` carries the silent-no-op signature: approved, diverged, and sitting on a
 * locked day that the correction does not own.
 *
 * Exits non-zero when anything is CONFIRMED, so it can be scheduled or gated in CI.
 *
 * Run: node scripts/verify-attendance-corrections-applied.cjs [--days=90] [--json]
 */
const mysql = require("mysql2/promise");
require("dotenv").config();

const argDays = Number((process.argv.find((a) => a.startsWith("--days=")) || "").split("=")[1]) || 90;
const asJson = process.argv.includes("--json");

// Legacy import codes -> canonical attendance_status. Only consulted when requested_status is null.
const LEGACY = { P: "present", A: "absent", HD: "half_day" };
// Codes with no canonical equivalent — excluded rather than guessed at.
const UNMAPPED = ["OD", "DH", "T"];

// Days whose status is decided by the calendar, not by a correction.
const CALENDAR = ["holiday", "week_off", "week_off_worked"];

// Statuses an approved HALF day transitions to 'half_day'. Mirrors the source side of
// src/shared/halfDayLeave.ts's HALF_DAY_ATTENDANCE_TRANSITION — kept in step by
// half-day-recovery-parity.test.ts. A day still sitting on one of these with an approved half day
// is unambiguous: the transition never ran.
const HALF_DAY_SOURCES = ["absent", "missing_punch", "unreconciled"];

async function main() {
  const c = await mysql.createConnection({
    host: process.env.DB_HOST, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    port: +(process.env.DB_PORT || 3306),
  });
  const since = `DATE_SUB(CURDATE(), INTERVAL ${argDays} DAY)`;

  const [regs] = await c.query(`
    SELECT r.id, r.employee_id, DATE_FORMAT(r.session_date,'%Y-%m-%d') d,
           COALESCE(r.requested_status, r.new_status) wanted_raw,
           d.attendance_status got, d.is_locked, d.regularization_id, d.override_by,
           r.reviewed_at, d.updated_at
      FROM attendance_regularization r
      JOIN attendance_daily_record d
        ON d.employee_id = r.employee_id AND d.record_date = r.session_date
     WHERE r.status = 'approved'
       AND r.session_date >= ${since}
       AND COALESCE(r.requested_status, r.new_status) IS NOT NULL
       AND COALESCE(r.requested_status, r.new_status) NOT IN (${UNMAPPED.map((s) => `'${s}'`).join(",")})
       AND d.attendance_status NOT IN (${CALENDAR.map((s) => `'${s}'`).join(",")})`);

  const [wholeLeave] = await c.query(`
    SELECT l.id, l.employee_id, DATE_FORMAT(l.from_date,'%Y-%m-%d') d, 'leave' wanted_raw,
           d.attendance_status got, d.is_locked, d.regularization_id, d.override_by,
           l.approved_at reviewed_at, d.updated_at
      FROM leave_request l
      JOIN attendance_daily_record d
        ON d.employee_id = l.employee_id AND d.record_date = l.from_date
     WHERE l.status = 'approved' AND l.from_date >= ${since} AND l.total_days = 1.00
       AND d.attendance_status NOT IN ('leave_approved','absent',${CALENDAR.map((s) => `'${s}'`).join(",")})`);

  // An approved HALF day still on a status the transition should have moved off.
  const [halfLeave] = await c.query(`
    SELECT l.id, l.employee_id, DATE_FORMAT(l.from_date,'%Y-%m-%d') d, 'half_day' wanted_raw,
           d.attendance_status got, d.is_locked, d.regularization_id, d.override_by,
           l.approved_at reviewed_at, d.updated_at
      FROM leave_request l
      JOIN attendance_daily_record d
        ON d.employee_id = l.employee_id AND d.record_date = l.from_date
     WHERE l.status = 'approved' AND l.from_date >= ${since} AND l.total_days = 0.50
       AND d.attendance_status IN (${HALF_DAY_SOURCES.map((s) => `'${s}'`).join(",")})`);

  const buckets = { confirmed: [], regraded: [], unexplained: [] };
  for (const r of [...regs, ...wholeLeave, ...halfLeave]) {
    const wanted = LEGACY[r.wanted_raw] ?? r.wanted_raw;
    if (wanted !== "leave" && wanted === r.got) continue; // agrees — not a divergence

    const locked = Number(r.is_locked) === 1;
    const ownedByThis = r.regularization_id === r.id;
    const changedAfterApproval =
      r.reviewed_at && r.updated_at && new Date(r.updated_at) > new Date(r.reviewed_at);

    const row = { employee: String(r.employee_id).slice(0, 8), date: r.d, wanted, got: r.got, locked: r.is_locked };
    if (locked && !ownedByThis) buckets.confirmed.push(row);
    else if (changedAfterApproval) buckets.regraded.push(row);
    else buckets.unexplained.push(row);
  }

  if (asJson) {
    console.log(JSON.stringify({ windowDays: argDays, counts: {
      confirmed: buckets.confirmed.length, regraded: buckets.regraded.length,
      unexplained: buckets.unexplained.length }, buckets }, null, 2));
  } else {
    console.log(`Attendance corrections reconciliation — last ${argDays} days\n`);
    const show = (key, title, note) => {
      console.log(`  ${String(buckets[key].length).padStart(5)}  ${title}`);
      console.log(`         ${note}`);
      if (buckets[key].length) console.table(buckets[key].slice(0, 5));
      console.log("");
    };
    show("confirmed", "CONFIRMED silently discarded",
      "approved, diverged, sitting on a locked day it does not own — the silent-no-op signature");
    show("regraded", "changed after approval",
      "the day was rewritten after the approval (COSEC re-sync / APR import) — a different question");
    show("unexplained", "diverged, cause not established",
      "unlocked and not touched since approval — needs eyes, not necessarily a fault");
    console.log(
      buckets.confirmed.length === 0
        ? "No silently discarded changes. Every approved change either landed or was later re-graded."
        : `${buckets.confirmed.length} approved change(s) were silently discarded.\n` +
          `Each one is a person who was told their change went through. Investigate before payroll runs.`,
    );
  }

  await c.end();
  if (buckets.confirmed.length > 0) process.exitCode = 1;
}

main().catch((e) => { console.error("ERR", e.message); process.exit(2); });
