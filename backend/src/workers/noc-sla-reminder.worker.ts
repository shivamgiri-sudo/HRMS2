/**
 * NOC clearance SLA reminders and escalation.
 *
 * Sweeps for signatory stages that are actionable, still pending, and past their SLA (48h by
 * default, per noc_signatory_template.sla_hours), sends a reminder, and escalates to the Branch
 * Head from the second reminder onward.
 *
 * WHY A WORKER AND NOT A CRON EXPRESSION
 *
 * Every periodic job in this codebase is setInterval + registerTimer, gated by worker_config and
 * wrapped in withWorkerLock. Introducing node-cron for one job would mean two scheduling
 * mechanisms and one of them untested in this deployment.
 *
 * REGISTERED IN TWO PLACES ON PURPOSE
 *
 * start/stop must be wired into BOTH workers/all-workers.ts AND server.ts. Production runs both
 * topologies, and a worker registered in only one file silently never runs in the other — the bug
 * that stopped ats-reminders and the five schedulers all-workers.ts's own comment describes.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It never auto-clears, auto-declines or advances a stage. An SLA breach is a prompt to a human,
 * not authority to sign on their behalf: these signatures are what substitute for wet ink on the
 * paper form, and a system-generated one would be worthless as evidence.
 */

import { db } from "../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { isWorkerEnabled, markWorkerRun } from "../shared/worker-config.js";
import { withWorkerLock, recordWorkerRun, registerTimer, unregisterTimer } from "./worker-utils.js";
import { notifySignatoryReminder } from "../modules/payroll/noc.notifications.js";

/**
 * Must match the worker_config.worker_name row exactly, or the kill switch silently does nothing —
 * isWorkerEnabled() fails OPEN on a missing row, so a typo here means an unstoppable worker rather
 * than a dead one.
 */
const WORKER_NAME = "noc-sla-reminder";

/** Hourly. The SLA is measured in days, so a tighter poll would only add load. */
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
/** Let the app finish booting before the first sweep. */
const STARTUP_DELAY_MS = 5 * 60 * 1000;
/**
 * Stop reminding after this many. Past three, a reminder has stopped being a prompt and become
 * noise that trains people to filter the sender — the escalation to Branch Head is the real
 * remedy, and beyond that it is a management conversation, not a mail loop.
 */
const MAX_REMINDERS = 3;
/** Reminders after the first also copy the Branch Head. */
const ESCALATE_FROM_REMINDER = 2;
/**
 * Per-sweep ceiling. Bounds the blast radius of a backlog: the gateway also enforces its own
 * per-event daily cap (max_per_day), and hitting that would starve genuinely new reminders for the
 * rest of the day.
 */
const MAX_PER_RUN = 40;

let intervalRef: ReturnType<typeof setInterval> | undefined;
let startupRef: ReturnType<typeof setTimeout> | undefined;

interface OverdueStage extends RowDataPacket {
  signatory_id: string;
  noc_case_id: string;
  stage_key: string;
  reminder_count: number;
}

/**
 * Stages that are genuinely overdue AND genuinely actionable.
 *
 * The tier gate is re-expressed in SQL rather than by calling stageBlockReason() per row: a stage
 * blocked behind a lower tier is not late, it is waiting, and reminding its owner would be telling
 * someone off for work they cannot start. The NOT EXISTS below is the same rule as the service's
 * tier check — every lower tier must have responded positively.
 *
 * Cases that are declined, completed or cancelled are excluded, as are those where the employee
 * has not submitted the form yet (status 'invited'), for the same reason.
 *
 * last_reminder_at guards the interval between reminders independently of the gateway's cooldown,
 * because the gateway's is per event+entity and this is per stage.
 */
async function findOverdueStages(): Promise<OverdueStage[]> {
  const [rows] = await db.execute<OverdueStage[]>(
    `SELECT s.id AS signatory_id, s.noc_case_id, s.stage_key, s.reminder_count
       FROM noc_signatory s
       JOIN noc_case c ON c.id = s.noc_case_id
      WHERE s.status = 'pending'
        AND s.sla_due_at IS NOT NULL
        AND s.sla_due_at < NOW()
        AND s.reminder_count < ?
        AND (s.last_reminder_at IS NULL OR s.last_reminder_at < DATE_SUB(NOW(), INTERVAL 24 HOUR))
        AND c.status IN ('employee_submitted', 'in_progress')
        AND NOT EXISTS (
              SELECT 1 FROM noc_signatory lower_s
               WHERE lower_s.noc_case_id = s.noc_case_id
                 AND lower_s.tier < s.tier
                 AND lower_s.status NOT IN ('accepted', 'acknowledged')
            )
        -- Finance is not late while it is structurally blocked on outstanding company property.
        AND NOT (
              s.requires_asset_clearance = 1
              AND EXISTS (
                    SELECT 1 FROM noc_asset_return a
                     WHERE a.noc_case_id = s.noc_case_id
                       AND a.is_mandatory_for_finance = 1
                       AND a.status <> 'returned'
                       AND a.waived_at IS NULL
                  )
            )
      ORDER BY s.sla_due_at
      LIMIT ${MAX_PER_RUN}`,
    [MAX_REMINDERS],
  );
  return rows;
}

async function sweep(): Promise<void> {
  if (!(await isWorkerEnabled(WORKER_NAME))) return;

  await withWorkerLock(WORKER_NAME, async () => {
    await recordWorkerRun(WORKER_NAME, "started").catch(() => undefined);
    let sent = 0;
    let failed = 0;

    try {
      const overdue = await findOverdueStages();
      for (const row of overdue) {
        const reminderNo = Number(row.reminder_count) + 1;
        try {
          const ok = await notifySignatoryReminder(
            String(row.noc_case_id),
            String(row.stage_key),
            reminderNo,
            reminderNo >= ESCALATE_FROM_REMINDER,
          );

          // The counter advances whether or not the send succeeded. If it only advanced on
          // success, a stage whose role resolves to nobody with an email would be retried every
          // hour forever, and MAX_REMINDERS would never bound it.
          await db.execute(
            `UPDATE noc_signatory
                SET reminder_count = reminder_count + 1,
                    last_reminder_at = NOW(),
                    escalated_at = CASE WHEN ? >= ? THEN COALESCE(escalated_at, NOW()) ELSE escalated_at END
              WHERE id = ?`,
            [reminderNo, ESCALATE_FROM_REMINDER, row.signatory_id],
          );

          if (ok) sent++; else failed++;
        } catch (err) {
          failed++;
          // One stage failing must not stop the rest of the sweep.
          console.error(
            `[NocSlaReminder] ${row.noc_case_id}/${row.stage_key}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }

      if (overdue.length > 0) {
        console.log(`[NocSlaReminder] ${overdue.length} overdue stage(s): ${sent} reminded, ${failed} failed`);
      }
      await markWorkerRun(WORKER_NAME).catch(() => undefined);
      await recordWorkerRun(WORKER_NAME, "completed", { overdue: overdue.length, sent, failed }).catch(() => undefined);
    } catch (err) {
      console.error("[NocSlaReminder] sweep failed:", err instanceof Error ? err.message : err);
      await recordWorkerRun(WORKER_NAME, "failed", {
        error: err instanceof Error ? err.message : String(err),
      }).catch(() => undefined);
    }
  });
}

export function startNocSlaReminderWorker(): void {
  if (intervalRef) return;
  startupRef = setTimeout(() => { void sweep(); }, STARTUP_DELAY_MS);
  intervalRef = setInterval(() => { void sweep(); }, CHECK_INTERVAL_MS);
  registerTimer(WORKER_NAME, intervalRef);
  console.log(`[NocSlaReminder] started — sweeping hourly, first run in ${STARTUP_DELAY_MS / 60000}m`);
}

export function stopNocSlaReminderWorker(): void {
  if (startupRef) { clearTimeout(startupRef); startupRef = undefined; }
  if (intervalRef) {
    clearInterval(intervalRef);
    unregisterTimer(WORKER_NAME);
    intervalRef = undefined;
    console.log("[NocSlaReminder] stopped");
  }
}
