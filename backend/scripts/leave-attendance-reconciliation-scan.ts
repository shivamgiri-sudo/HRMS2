/**
 * Read-only scan: approved leave-days with no matching attendance_daily_record
 * (leave_approved / absent / holiday / week_off) for that employee+date.
 *
 * Reproduces and classifies the same population documented in
 * uat/UAT_DEFECT_REGISTER.csv D004 and uat/WORKLIST_LEAVE_ATTENDANCE_MISMATCH.csv,
 * so the classification can be re-run and diffed against that snapshot instead of
 * re-derived by hand each time. Columns verified live against this DB's
 * information_schema on 2026-08-18 (leave_request has no day-level child table -
 * from_date/to_date is expanded via a recursive CTE; attendance_daily_record's date
 * column is record_date, not attendance_date).
 *
 * Classification (mirrors D004's finding):
 *   LEGACY_MIGRATED - legacy_leave_id is populated AND approved_at IS NULL.
 *     Bulk-migrated pre-launch history; never went through the live
 *     leaveService.reviewRequest() write path. NOT a live-code defect.
 *   LIVE_UNRECONCILED - approved_at IS NOT NULL (a real, live-code approval)
 *     with no matching attendance row. This is the one bucket that would
 *     indicate an actual defect in the current approval-to-attendance write
 *     path (leave.service.ts ~line 661-687) - flag loudly if any appear.
 *   OTHER - neither of the above (approved_at NULL, no legacy_leave_id) -
 *     needs manual review, don't assume either bucket.
 *
 * No writes. A companion cleanup script does not exist yet and should not be built
 * until a human decides what "cleanup" even means here - see D004/P005:
 * bulk-overwriting migrated history is explicitly forbidden, so unlike the BGV
 * duplicate cleanup this is very likely scan-only, feeding an HR/Payroll worklist
 * rather than an automated fix.
 *
 * Run: npx tsx backend/scripts/leave-attendance-reconciliation-scan.ts [--days=90]
 */
import { db } from "../src/db/mysql.js";

async function main() {
  const daysArg = process.argv.find((a) => a.startsWith("--days="));
  const days = daysArg ? Number(daysArg.split("=")[1]) : 90;

  const [rows] = await db.execute(
    `WITH RECURSIVE date_span AS (
        SELECT lr.id AS leave_request_id, lr.employee_id, lr.leave_type_code,
               lr.approved_at, lr.legacy_leave_id, lr.from_date AS d, lr.to_date AS to_date
          FROM leave_request lr
         WHERE lr.status = 'approved'
           AND lr.to_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
        UNION ALL
        SELECT leave_request_id, employee_id, leave_type_code, approved_at, legacy_leave_id,
               DATE_ADD(d, INTERVAL 1 DAY), to_date
          FROM date_span
         WHERE d < to_date
     )
     SELECT ds.leave_request_id, e.employee_code, e.full_name, ds.d AS leave_date,
            ds.leave_type_code, ds.approved_at, ds.legacy_leave_id
       FROM date_span ds
       JOIN employees e ON e.id = ds.employee_id
       LEFT JOIN attendance_daily_record adr
         ON adr.employee_id = ds.employee_id
        AND adr.record_date = ds.d
        AND adr.attendance_status IN ('leave_approved','absent','holiday','week_off')
      WHERE adr.id IS NULL
      ORDER BY ds.d DESC`,
    [days]
  ).catch((err) => {
    console.error(
      "Query failed - schema may have drifted since this was written (2026-08-18). " +
      "Verify table/column names against live information_schema before trusting any " +
      "count below. Raw error:",
      err.message
    );
    throw err;
  });

  const r = rows as any[];
  if (!r.length) {
    console.log(`No unreconciled approved-leave days in the last ${days} days. Nothing to report.`);
    process.exit(0);
  }

  let legacyMigrated = 0;
  let liveUnreconciled = 0;
  let other = 0;
  const liveOffenders: any[] = [];

  for (const row of r) {
    const isLegacy = row.legacy_leave_id != null && row.approved_at == null;
    const isLive = row.approved_at != null;
    if (isLegacy) {
      legacyMigrated++;
    } else if (isLive) {
      liveUnreconciled++;
      liveOffenders.push(row);
    } else {
      other++;
    }
  }

  console.log(`=== Leave-Attendance Reconciliation Scan (last ${days} days) ===`);
  console.log(`Total unreconciled approved-leave-days: ${r.length}`);
  console.log(`  LEGACY_MIGRATED (pre-launch bulk import, approved_at NULL): ${legacyMigrated}`);
  console.log(`  LIVE_UNRECONCILED (approved_at set - real live-code approval, no attendance row): ${liveUnreconciled}`);
  console.log(`  OTHER (needs manual review): ${other}`);

  if (liveUnreconciled > 0) {
    console.log(
      `\n⚠️  ${liveUnreconciled} row(s) went through a LIVE approval (approved_at IS NOT NULL) ` +
      `and still have no attendance row. Per D004 this bucket was ZERO as of this session's ` +
      `earlier check - if it is non-zero now, that is a genuine regression in ` +
      `leave.service.ts's attendance-write path and should be investigated before anything ` +
      `else in this scan.`
    );
    for (const o of liveOffenders.slice(0, 20)) {
      console.log(
        `    ${o.employee_code}  ${o.full_name}  ${o.leave_date}  leave_request_id=${o.leave_request_id}  approved_at=${o.approved_at}`
      );
    }
    if (liveOffenders.length > 20) {
      console.log(`    ... and ${liveOffenders.length - 20} more`);
    }
  } else {
    console.log(
      `\nNo live-code offenders found - consistent with D004's finding that the current ` +
      `approval-to-attendance write path has no proven live defect. All unreconciled rows ` +
      `are historical/migrated data requiring HR/Payroll review, not a code fix.`
    );
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Scan failed:", err);
  process.exit(1);
});
