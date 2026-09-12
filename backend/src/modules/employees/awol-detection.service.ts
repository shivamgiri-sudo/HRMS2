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
 * ─────────────────────────────────────────────────────────────────────────────
 * Owner ruling 2026-09-12 changed both the threshold and the audience.
 *
 * WAS: most recent record within 3 days is 'absent', AND 3 of the last 5 recorded
 *      attendance days are 'absent'. Item addressed to the `hr` role.
 *
 * NOW: absent on SEVEN CONSECUTIVE recorded attendance days, and the item goes to
 *      the REPORTING MANAGER — because only their confirmation may turn a no-show
 *      into an absconding. Payroll HR gets a parallel notice, since an unconfirmed
 *      no-show is still drawing salary.
 *
 * "Consecutive" means seven consecutive RECORDED attendance days, not seven calendar
 * days. Attendance is not written for every employee on every date (week-offs and
 * holidays are frequently absent from the table entirely), so counting calendar days
 * would require inventing a working-day calendar here and would disagree with the
 * attendance engine that owns one. Seven recorded days in a row all reading 'absent'
 * is the same fact expressed in the data that exists.
 *
 * The scan NEVER marks anyone absconded. It raises a decision to a human. The exit is
 * created only when the reporting manager confirms, and it is dated the last day the
 * employee actually worked — see exit.service.createExitRequest, where that date
 * becomes the last working day rather than that date plus a grace period.
 *
 * Deliberately reads the *actual* recorded status, so a missing row (a new joiner with
 * no attendance history yet) can never be mistaken for an explicit 'absent': the
 * window is built from rows that exist, and an employee without seven recorded days
 * simply cannot match.
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
// has their last seven recorded days well inside 45 days. It only ever narrows
// the candidate set fed into ROW_NUMBER()/SUM() OVER(...), which itself does
// the real "most recent" and "last N" logic per employee.
const LOOKBACK_DAYS = 45;

/** Consecutive recorded absent days before a no-show is raised for confirmation. */
const CONSECUTIVE_ABSENT_DAYS = 7;

// Matches the per-row try/catch isolation pattern in ats-reminders.cron.ts:
// one employee's trigger failure must never abort the sweep for the rest.
export async function runAwolDetectionScan(): Promise<void> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       e.id AS employee_id,
       e.employee_code,
       COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS full_name,
       e.branch_id,
       -- The reporting manager's LOGIN id, not their employee id. work_item.assigned_to_user_id
       -- holds an auth_user id everywhere in the work-inbox module (see assertWorkItemAccess),
       -- and getMyWorkItems matches it against the signed-in user. manager_id is the documented
       -- fallback for rows where reporting_manager_id was never populated.
       mgr.user_id AS reporting_manager_user_id,
       -- The last day this employee was actually present. Becomes their last working day if the
       -- manager confirms, and therefore the date payroll pays them up to, so it is established
       -- from attendance rather than assumed. NULL when they have no non-absent record in the
       -- lookback window at all, which the trigger reports honestly instead of guessing.
       (SELECT MAX(w.record_date)
          FROM attendance_daily_record w
         WHERE w.employee_id = e.id
           AND w.record_date >= DATE_SUB(CURDATE(), INTERVAL ${LOOKBACK_DAYS} DAY)
           AND w.attendance_status <> 'absent') AS last_worked_date
     FROM employees e
     JOIN (
       SELECT x.employee_id
       FROM (
         SELECT adr.employee_id,
                adr.attendance_status,
                ROW_NUMBER() OVER (PARTITION BY adr.employee_id ORDER BY adr.record_date DESC) AS rn
         FROM attendance_daily_record adr
         WHERE adr.record_date >= DATE_SUB(CURDATE(), INTERVAL ${LOOKBACK_DAYS} DAY)
       ) x
       -- The seven most recent recorded days only.
       WHERE x.rn <= ${CONSECUTIVE_ABSENT_DAYS}
       GROUP BY x.employee_id
       -- All seven present AND all seven absent. Both halves are load-bearing: the COUNT
       -- requires the employee to actually have seven recorded days (a new joiner with three
       -- cannot match), and the SUM requires every one of them to be 'absent' — which is what
       -- makes the run consecutive, since these are the seven most recent rows in date order
       -- with nothing in between.
       HAVING COUNT(*) = ${CONSECUTIVE_ABSENT_DAYS}
          AND SUM(x.attendance_status = 'absent') = ${CONSECUTIVE_ABSENT_DAYS}
     ) awol ON awol.employee_id = e.id
     LEFT JOIN employees mgr ON mgr.id = COALESCE(e.reporting_manager_id, e.manager_id)
     WHERE e.active_status = 1
       -- no approved/pending leave request covers any part of the absent window
       AND NOT EXISTS (
         SELECT 1 FROM leave_request lr
         WHERE lr.employee_id = e.id
           AND lr.status NOT IN ('rejected', 'discarded', 'cancelled')
           AND lr.from_date <= CURDATE()
           AND lr.to_date >= DATE_SUB(CURDATE(), INTERVAL ${CONSECUTIVE_ABSENT_DAYS + 3} DAY)
       )
       -- no exit_request row exists for them at all
       AND NOT EXISTS (
         SELECT 1 FROM exit_request er WHERE er.employee_id = e.id
       )
     ORDER BY e.employee_code
     LIMIT 500`
  );

  for (const row of rows) {
    try {
      await triggerAwolSuspected(
        row.employee_id as string,
        (row.full_name ?? row.employee_code ?? "Employee") as string,
        (row.branch_id as string | null) ?? undefined,
        {
          reportingManagerUserId: (row.reporting_manager_user_id as string | null) ?? null,
          // Formatted, not handed over as a Date: mysql2 returns a DATE as a host-timezone JS
          // Date and this codebase has a documented history of that shifting the day. On this
          // value a day is a day of pay.
          lastWorkedDate: row.last_worked_date
            ? new Date(row.last_worked_date as string | Date).toISOString().slice(0, 10)
            : null,
          absentDays: CONSECUTIVE_ABSENT_DAYS,
        }
      );
    } catch (err) {
      console.warn(`[awol-detection] failed for employee ${row.employee_id as string}:`, err);
    }
  }

  if (rows.length > 0) {
    console.log(
      `[awol-detection] raised ${rows.length} absconding confirmation(s) for reporting managers`
    );
  }
}
