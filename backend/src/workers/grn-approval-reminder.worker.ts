/**
 * GRN-approval reminders.
 *
 * Sweeps for GRNs stuck at status='submitted' (awaiting Branch Head) or
 * 'branch_head_approved' (awaiting Accounts Head) for 24+ hours with no decision, and
 * reminds whoever currently owns that stage via grn_approval_overdue
 * (grn.notifications.ts's notifyGrnApprovalOverdue). Mirrors
 * leave-approval-reminder.worker.ts's shape exactly: same setInterval + worker_config +
 * withWorkerLock pattern, same reminder_count/last_reminder_at columns, same MAX_REMINDERS
 * cutoff.
 *
 * ROLLOUT_AT — WHY THIS EXISTS
 *
 * Measured live the day this shipped (2026-09-17): 21 GRNs already sitting at 'submitted'
 * and 141 at 'branch_head_approved'. Every one of those has been in its stage far longer
 * than 24h, so without a floor the very first sweep would fire up to 162 reminder emails,
 * with the 141 landing on exactly 2 Accounts Head inboxes in one run (capped by MAX_PER_RUN,
 * so really 2 runs) — reads as a system malfunction, not a helpful nudge. ROLLOUT_AT is a
 * code-level backfill floor, the same shape provisioning_overdue's DB
 * notification_event_config.backfill_floor_at column achieves for that event: only GRNs
 * that ENTER a pending stage on or after this timestamp are ever reminded. The existing
 * backlog is a separate, deliberate non-goal of this change — clearing it (or deciding not
 * to) is an operational decision, not a notification-wiring one.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It never auto-approves, auto-rejects or advances a stage. It also never reminds about the
 * Accounts Head -> Finance Head handoff — that stage has no email at all yet (see
 * grn.notifications.ts's header for why), so there is nothing here for it to remind about.
 */

import { db } from "../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { isWorkerEnabled, markWorkerRun } from "../shared/worker-config.js";
import { withWorkerLock, recordWorkerRun, registerTimer, unregisterTimer } from "./worker-utils.js";
import { notifyGrnApprovalOverdue } from "../modules/finance/grn.notifications.js";

/** Must match the worker_config.worker_name row exactly — isWorkerEnabled() fails OPEN on a missing row. */
const WORKER_NAME = "grn-approval-reminder";

/** Hourly — the SLA itself is 24h, so a tighter poll only adds load. */
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
/** Let the app finish booting before the first sweep. */
const STARTUP_DELAY_MS = 5 * 60 * 1000;
/** Owner directive: 24h grace period before the first nudge (same default used for leave). */
const SLA_HOURS = 24;
/** Stop after three — beyond that it is a management conversation, not a mail loop. */
const MAX_REMINDERS = 3;
/** Per-sweep ceiling, matching the gateway's own daily cap philosophy. */
const MAX_PER_RUN = 100;
/** See the file header — excludes the pre-existing 162-GRN backlog from ever being reminded. */
const ROLLOUT_AT = "2026-09-17 00:00:00";

let intervalRef: ReturnType<typeof setInterval> | undefined;
let startupRef: ReturnType<typeof setTimeout> | undefined;

type PendingStage = "branch_head" | "accounts_head";

interface OverdueGrnRow extends RowDataPacket {
  id: string;
  status: "submitted" | "branch_head_approved";
  reminder_count: number;
}

function stageForStatus(status: string): PendingStage {
  return status === "submitted" ? "branch_head" : "accounts_head";
}

async function findOverdueGrns(): Promise<OverdueGrnRow[]> {
  const [rows] = await db.execute<OverdueGrnRow[]>(
    `SELECT id, status, reminder_count,
            CASE WHEN status = 'submitted' THEN submitted_at
                 WHEN status = 'branch_head_approved' THEN branch_head_reviewed_at
            END AS stage_entered_at
       FROM grn_request
      WHERE status IN ('submitted', 'branch_head_approved')
        AND reminder_count < ?
        AND (last_reminder_at IS NULL OR last_reminder_at < DATE_SUB(NOW(), INTERVAL ? HOUR))
     HAVING stage_entered_at IS NOT NULL
        AND stage_entered_at < DATE_SUB(NOW(), INTERVAL ? HOUR)
        AND stage_entered_at >= ?
      ORDER BY stage_entered_at
      LIMIT ${MAX_PER_RUN}`,
    [MAX_REMINDERS, SLA_HOURS, SLA_HOURS, ROLLOUT_AT],
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
      const overdue = await findOverdueGrns();
      for (const row of overdue) {
        const reminderNo = Number(row.reminder_count) + 1;
        try {
          const ok = await notifyGrnApprovalOverdue(String(row.id), stageForStatus(row.status), reminderNo);

          // Advances whether or not the send succeeded — same reasoning as
          // leave-approval-reminder.worker.ts: only advancing on success would retry a GRN
          // whose current approver has no resolvable email forever, and MAX_REMINDERS would
          // never bound it.
          await db.execute(
            `UPDATE grn_request
                SET reminder_count = reminder_count + 1,
                    last_reminder_at = NOW()
              WHERE id = ?`,
            [row.id],
          );

          if (ok) sent++; else failed++;
        } catch (err) {
          failed++;
          console.error(`[GrnApprovalReminder] ${row.id}:`, err instanceof Error ? err.message : err);
        }
      }

      if (overdue.length > 0) {
        console.log(`[GrnApprovalReminder] ${overdue.length} overdue GRN(s): ${sent} reminded, ${failed} failed`);
      }
      await markWorkerRun(WORKER_NAME).catch(() => undefined);
      await recordWorkerRun(WORKER_NAME, "completed", { overdue: overdue.length, sent, failed }).catch(() => undefined);
    } catch (err) {
      console.error("[GrnApprovalReminder] sweep failed:", err instanceof Error ? err.message : err);
      await recordWorkerRun(WORKER_NAME, "failed", {
        error: err instanceof Error ? err.message : String(err),
      }).catch(() => undefined);
    }
  });
}

export function startGrnApprovalReminderWorker(): void {
  if (intervalRef) return;
  startupRef = setTimeout(() => { void sweep(); }, STARTUP_DELAY_MS);
  intervalRef = setInterval(() => { void sweep(); }, CHECK_INTERVAL_MS);
  registerTimer(WORKER_NAME, intervalRef);
  console.log(`[GrnApprovalReminder] started — sweeping hourly, first run in ${STARTUP_DELAY_MS / 60000}m`);
}

export function stopGrnApprovalReminderWorker(): void {
  if (startupRef) { clearTimeout(startupRef); startupRef = undefined; }
  if (intervalRef) {
    clearInterval(intervalRef);
    unregisterTimer(WORKER_NAME);
    intervalRef = undefined;
    console.log("[GrnApprovalReminder] stopped");
  }
}
