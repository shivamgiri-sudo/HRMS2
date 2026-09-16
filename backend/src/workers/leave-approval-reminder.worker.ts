/**
 * Leave-approval reminders.
 *
 * Sweeps for leave requests stuck at status='pending' (awaiting the reporting manager) for
 * 24+ hours, and reminds the same recipients leave_submitted already addressed — the
 * approver, cc branch HR — via the `leave_approval_overdue` event, which was already
 * registered live in notification_event_config with zero producers anywhere in the app
 * (see 1784_leave_approval_overdue_reminder.sql). Mirrors noc-sla-reminder.worker.ts's
 * shape exactly: same setInterval + worker_config + withWorkerLock pattern, same
 * reminder_count/last_reminder_at columns, same MAX_REMINDERS cutoff.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It never auto-approves, auto-rejects or escalates a request itself. A stalled leave
 * approval already has a real escalation path (leave_pending_branch_head, fired once by
 * leave.service.ts's own third-EL-occurrence rule) — this worker only reminds the person
 * who can actually act, it does not reroute the decision.
 *
 * Requests already at status='pending_branch_head' are out of scope: that escalation has
 * its own one-time notification and a different recipient (branch head), and reminding the
 * original manager about a decision that has moved past them would be confusing, not
 * helpful.
 */

import { db } from "../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { isWorkerEnabled, markWorkerRun } from "../shared/worker-config.js";
import { withWorkerLock, recordWorkerRun, registerTimer, unregisterTimer } from "./worker-utils.js";
import { notifyLeaveApprovalOverdue } from "../modules/leave/leave.notifications.js";

/** Must match the worker_config.worker_name row exactly — isWorkerEnabled() fails OPEN on a missing row. */
const WORKER_NAME = "leave-approval-reminder";

/** Hourly — the SLA itself is 24h, so a tighter poll only adds load. */
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
/** Let the app finish booting before the first sweep. */
const STARTUP_DELAY_MS = 5 * 60 * 1000;
/** Owner directive: 24h grace period before the first nudge. */
const SLA_HOURS = 24;
/** Stop after three — beyond that it is a management conversation, not a mail loop. */
const MAX_REMINDERS = 3;
/** Per-sweep ceiling, matching the gateway's own daily cap philosophy. */
const MAX_PER_RUN = 100;

let intervalRef: ReturnType<typeof setInterval> | undefined;
let startupRef: ReturnType<typeof setTimeout> | undefined;

interface OverdueLeaveRow extends RowDataPacket {
  id: string;
  reminder_count: number;
}

async function findOverdueLeaveRequests(): Promise<OverdueLeaveRow[]> {
  const [rows] = await db.execute<OverdueLeaveRow[]>(
    `SELECT id, reminder_count
       FROM leave_request
      WHERE status = 'pending'
        AND created_at < DATE_SUB(NOW(), INTERVAL ? HOUR)
        AND reminder_count < ?
        AND (last_reminder_at IS NULL OR last_reminder_at < DATE_SUB(NOW(), INTERVAL ? HOUR))
      ORDER BY created_at
      LIMIT ${MAX_PER_RUN}`,
    [SLA_HOURS, MAX_REMINDERS, SLA_HOURS],
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
      const overdue = await findOverdueLeaveRequests();
      for (const row of overdue) {
        const reminderNo = Number(row.reminder_count) + 1;
        try {
          const ok = await notifyLeaveApprovalOverdue(String(row.id), reminderNo);

          // Advances whether or not the send succeeded — the same reasoning as
          // noc-sla-reminder.worker.ts: only advancing on success would retry a request
          // whose approver has no resolvable email forever, and MAX_REMINDERS would never
          // bound it.
          await db.execute(
            `UPDATE leave_request
                SET reminder_count = reminder_count + 1,
                    last_reminder_at = NOW()
              WHERE id = ?`,
            [row.id],
          );

          if (ok) sent++; else failed++;
        } catch (err) {
          failed++;
          console.error(`[LeaveApprovalReminder] ${row.id}:`, err instanceof Error ? err.message : err);
        }
      }

      if (overdue.length > 0) {
        console.log(`[LeaveApprovalReminder] ${overdue.length} overdue request(s): ${sent} reminded, ${failed} failed`);
      }
      await markWorkerRun(WORKER_NAME).catch(() => undefined);
      await recordWorkerRun(WORKER_NAME, "completed", { overdue: overdue.length, sent, failed }).catch(() => undefined);
    } catch (err) {
      console.error("[LeaveApprovalReminder] sweep failed:", err instanceof Error ? err.message : err);
      await recordWorkerRun(WORKER_NAME, "failed", {
        error: err instanceof Error ? err.message : String(err),
      }).catch(() => undefined);
    }
  });
}

export function startLeaveApprovalReminderWorker(): void {
  if (intervalRef) return;
  startupRef = setTimeout(() => { void sweep(); }, STARTUP_DELAY_MS);
  intervalRef = setInterval(() => { void sweep(); }, CHECK_INTERVAL_MS);
  registerTimer(WORKER_NAME, intervalRef);
  console.log(`[LeaveApprovalReminder] started — sweeping hourly, first run in ${STARTUP_DELAY_MS / 60000}m`);
}

export function stopLeaveApprovalReminderWorker(): void {
  if (startupRef) { clearTimeout(startupRef); startupRef = undefined; }
  if (intervalRef) {
    clearInterval(intervalRef);
    unregisterTimer(WORKER_NAME);
    intervalRef = undefined;
    console.log("[LeaveApprovalReminder] stopped");
  }
}
