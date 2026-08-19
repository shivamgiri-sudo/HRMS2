/**
 * AWOL Detection Scan
 *
 * There was no automated sweep anywhere for an employee who simply stops
 * showing up — no leave applied, no resignation filed. The closest existing
 * thing, business-intelligence/bi.service.ts::getAttritionRiskSignal(), is a
 * read-only dashboard query framed as attrition-risk (30-day absence count,
 * no leave/exit exclusion) and creates no task. This is a different concern:
 * a targeted, task-creating detector for the narrower "possibly AWOL" state.
 *
 * Definition (data-vetted live, 2026-08-19 — 46 active employees matched at
 * time of investigation; re-verified live during build, 41 matched a few
 * hours later the same day, which tracks with the population drifting hour
 * to hour rather than the query being wrong):
 *
 *   (a) the employee's most recent attendance_daily_record (within the last
 *       3 days) has attendance_status = 'absent'
 *   (b) at least 3 of their last 5 recorded attendance days are 'absent'
 *   (c) no leave_request row (approved or still pending) covers any part of
 *       the last 10 days
 *   (d) no exit_request row exists for them at all
 *
 * Deliberately reads the *actual* most recent record's status, not "most
 * recent absent record" — the earlier investigation flagged and avoided a
 * false-positive trap where a missing row (new joiner with no attendance
 * history yet) could be mistaken for an explicit 'absent'. Requiring
 * attendance_status = 'absent' on the row itself means a genuinely missing
 * row can never match: NOT EXISTS / no row simply excludes the employee.
 *
 * Read-only against attendance_daily_record. Does not touch
 * wfm/attendance-engine.service.ts or anything that computes attendance —
 * only SELECTs the table it writes.
 */

import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { triggerAwolSuspected } from "../work-inbox/work-inbox.triggers.js";

// 45-day lookback is a performance guard on the window function, not part of
// the definition: any active employee with roughly-daily attendance records
// has their "last 5 recorded days" well inside 45 days. It only ever narrows
// the candidate set fed into ROW_NUMBER()/SUM() OVER(...), which itself does
// the real "most recent" and "last 5" logic per employee.
const LOOKBACK_DAYS = 45;

// Matches the per-row try/catch isolation pattern in ats-reminders.cron.ts:
// one employee's trigger failure must never abort the sweep for the rest.
export async function runAwolDetectionScan(): Promise<void> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       e.id AS employee_id,
       e.employee_code,
       COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS full_name,
       e.branch_id
     FROM employees e
     JOIN (
       SELECT x.employee_id, x.record_date, x.attendance_status, x.absent_of_5
       FROM (
         SELECT adr.employee_id, adr.record_date, adr.attendance_status,
                ROW_NUMBER() OVER (PARTITION BY adr.employee_id ORDER BY adr.record_date DESC) AS rn,
                SUM(adr.attendance_status = 'absent') OVER (
                  PARTITION BY adr.employee_id ORDER BY adr.record_date DESC
                  ROWS BETWEEN CURRENT ROW AND 4 FOLLOWING
                ) AS absent_of_5
         FROM attendance_daily_record adr
         WHERE adr.record_date >= DATE_SUB(CURDATE(), INTERVAL ${LOOKBACK_DAYS} DAY)
       ) x
       WHERE x.rn = 1
     ) latest ON latest.employee_id = e.id
     WHERE e.active_status = 1
       -- (a) most recent record is within the last 3 days and is explicitly 'absent'
       AND latest.attendance_status = 'absent'
       AND latest.record_date >= DATE_SUB(CURDATE(), INTERVAL 3 DAY)
       -- (b) at least 3 of the last 5 recorded attendance days are 'absent'
       AND latest.absent_of_5 >= 3
       -- (c) no approved/pending leave request covers any part of the last 10 days
       AND NOT EXISTS (
         SELECT 1 FROM leave_request lr
         WHERE lr.employee_id = e.id
           AND lr.status NOT IN ('rejected', 'discarded', 'cancelled')
           AND lr.from_date <= CURDATE()
           AND lr.to_date >= DATE_SUB(CURDATE(), INTERVAL 10 DAY)
       )
       -- (d) no exit_request row exists for them at all
       AND NOT EXISTS (
         SELECT 1 FROM exit_request er WHERE er.employee_id = e.id
       )
     ORDER BY latest.record_date DESC
     LIMIT 500`
  );

  for (const row of rows) {
    try {
      await triggerAwolSuspected(
        row.employee_id as string,
        (row.full_name ?? row.employee_code ?? "Employee") as string,
        (row.branch_id as string | null) ?? undefined
      );
    } catch (err) {
      console.warn(`[awol-detection] failed for employee ${row.employee_id as string}:`, err);
    }
  }

  if (rows.length > 0) {
    console.log(`[awol-detection] flagged ${rows.length} possibly-AWOL employee(s)`);
  }
}
