/**
 * Decide the leave requests still sitting pending for a month, through the real leave engine.
 *
 * WHY THESE MATTER NOW. Nine requests covering 44 days sat pending for August 2026 while that
 * month was being prepared for its first real payroll run. Every one of their days is recorded
 * `missing_punch` or `absent` — both of which pay ZERO — and not one day across all nine shows
 * `present`. So these people were genuinely away, are currently being paid nothing for it, and
 * the only thing standing between them and paid leave is a decision nobody made.
 *
 * WHAT THIS DOES NOT DO. It does not decide entitlement. Every request goes through
 * leaveService.reviewRequest(), the same call a manager's click makes, so the annual cap, the
 * one-EL-per-calendar-month rule, the balance check and the attendance write all run exactly as
 * they always do. Anyone over their entitlement is REFUSED here, by the same rule and with the
 * same message they would get in the UI. That refusal is a feature: it is what stops a bulk
 * decision handing out leave nobody is owed.
 *
 * SCOPE IS A DATE WINDOW, ON PURPOSE. 35 requests are still pending from 2018–2025, and one each
 * from January and June 2026. Those are not stale paperwork to be swept up — approving leave in
 * a month whose payroll has already been paid needs an arrears decision, not a script. They are
 * deliberately out of reach unless someone names their window explicitly.
 *
 * Dry-run by default. Set APPLY=1 to decide them.
 *
 * Run: FROM=2026-08-01 TO=2026-08-31 ./node_modules/.bin/tsx scripts/approve-pending-leave.ts
 *      FROM=2026-08-01 TO=2026-08-31 APPLY=1 ./node_modules/.bin/tsx scripts/approve-pending-leave.ts
 */
import "dotenv/config";

const APPLY = process.env.APPLY === "1";
const FROM = process.env.FROM ?? "2026-08-01";
const TO = process.env.TO ?? "2026-08-31";
const ACTOR_EMAIL = process.env.ACTOR_EMAIL ?? "shivam.giri@teammas.in";
const REMARKS =
  process.env.REMARKS ??
  "Approved during the August 2026 attendance finalisation. Attendance for every day of this " +
  "request shows missing_punch or absent (both pay zero) and no day shows present.";

async function main() {
  const { db } = await import("../src/db/mysql.js");
  const { leaveService } = await import("../src/modules/leave/leave.service.js");

  const [users]: any = await db.query(`SELECT id FROM auth_user WHERE email = ? LIMIT 1`, [ACTOR_EMAIL]);
  if (!users.length) throw new Error(`No auth_user for ${ACTOR_EMAIL}`);
  const reviewerId = String(users[0].id);

  const [rows]: any = await db.query(
    `SELECT l.id, e.employee_code, lt.leave_code, l.total_days, l.status,
            DATE_FORMAT(l.from_date,'%Y-%m-%d') frm, DATE_FORMAT(l.to_date,'%Y-%m-%d') too,
            (SELECT COUNT(*) FROM attendance_daily_record d
              WHERE d.employee_id = l.employee_id
                AND d.record_date BETWEEN l.from_date AND l.to_date
                AND d.attendance_status = 'present') present_days
       FROM leave_request l
       LEFT JOIN employees e ON e.id = l.employee_id
       LEFT JOIN leave_type_master lt ON lt.id = l.leave_type_id
      WHERE l.status IN ('pending','pending_branch_head')
        AND l.from_date BETWEEN ? AND ?
      ORDER BY l.from_date`,
    [FROM, TO],
  );

  console.log(`acting as ${ACTOR_EMAIL}`);
  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — ${rows.length} pending request(s) between ${FROM} and ${TO}\n`);
  if (!rows.length) { await (db as any).end?.(); return; }

  let approved = 0, refused = 0, skipped = 0;
  for (const r of rows) {
    const label = `${r.employee_code} ${r.leave_code} ${r.frm}..${r.too} (${r.total_days}d)`;

    // A day already recorded as worked contradicts the request. Approving it would pay the day
    // twice over and overwrite real attendance — that needs a human, not a loop.
    if (Number(r.present_days) > 0) {
      console.log(`  SKIP    ${label} — ${r.present_days} day(s) already recorded present; needs a human`);
      skipped++;
      continue;
    }

    if (!APPLY) { console.log(`  would approve  ${label}`); continue; }

    try {
      await leaveService.reviewRequest(r.id, { status: "approved", remarks: REMARKS } as any, reviewerId);
      console.log(`  APPROVED  ${label}`);
      approved++;
    } catch (e: any) {
      // Entitlement refusals land here, and they are the system working. Reported, not retried.
      console.log(`  REFUSED   ${label}\n              ${e?.message ?? String(e)}`);
      refused++;
    }
  }

  if (APPLY) {
    console.log(`\napproved=${approved}  refused=${refused}  skipped=${skipped}`);
  } else {
    console.log(`\nNo changes written. Re-run with APPLY=1 to decide them.`);
  }
  await (db as any).end?.();
}

main().catch((e) => {
  console.error("ERR", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
