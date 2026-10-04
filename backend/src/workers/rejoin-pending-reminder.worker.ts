import type { RowDataPacket } from "mysql2";
import { db } from "../db/mysql.js";
import { isWorkerEnabled, markWorkerRun } from "../shared/worker-config.js";
import { withWorkerLock, recordWorkerRun, registerTimer, unregisterTimer } from "./worker-utils.js";
import { notifyRejoinReminder, notifyRejoinEscalation } from "../modules/employees/rehire/rejoinNotifications.js";
import type { SqlExecutor } from "../modules/employees/rehire/rehireFacts.js";

// Must match the worker_config row seeded in migration 2080. isWorkerEnabled fails OPEN on a missing row.
const WORKER_NAME = "rejoin-pending-reminder";
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const STARTUP_DELAY_MS = 7 * 60 * 1000;
export const REMINDER_EVERY_HOURS = 48; // reminder 1 at 48h, reminder 2 at 96h
export const MAX_REMINDERS = 2;
export const ESCALATE_AFTER_DAYS = 5;
const MAX_PER_RUN = 100;
// Requests from the old two-step flow predate this; do not blast them.
const ROLLOUT_AT = "2026-10-04 00:00:00";

let intervalRef: ReturnType<typeof setInterval> | undefined;
let startupRef: ReturnType<typeof setTimeout> | undefined;

export interface ReminderDeps {
  notifyReminder: (requestId: string, reminderNo: number) => Promise<boolean>;
  notifyEscalation: (requestId: string) => Promise<boolean>;
}
export interface SweepResult { reminded: number; escalated: number; failed: number }

export async function runRejoinReminderSweep(exec: SqlExecutor, deps: ReminderDeps): Promise<SweepResult> {
  const out: SweepResult = { reminded: 0, escalated: 0, failed: 0 };
  try {
    // Due reminders: reminder k (0-based count) is due when the request is older than 48h x (k + 1).
    const [due] = await exec.execute<RowDataPacket[]>(
      `SELECT id, reminder_count FROM employee_reactivation_requests
        WHERE status = 'pending'
          AND created_at >= ?
          AND reminder_count < ?
          AND created_at <= DATE_SUB(NOW(), INTERVAL (? * (reminder_count + 1)) HOUR)
          AND (last_reminder_at IS NULL OR last_reminder_at < DATE_SUB(NOW(), INTERVAL 1 HOUR))
        ORDER BY created_at LIMIT ${MAX_PER_RUN}`,
      [ROLLOUT_AT, MAX_REMINDERS, REMINDER_EVERY_HOURS],
    );
    for (const row of due) {
      const reminderNo = Number(row.reminder_count) + 1;
      let ok = false;
      try {
        ok = await deps.notifyReminder(String(row.id), reminderNo);
      } catch (err) {
        console.error(`[RejoinReminder] ${row.id}:`, err instanceof Error ? err.message : err);
      }
      // Advances whether or not the send worked, so MAX_REMINDERS bounds an unreachable branch head.
      await exec.execute(
        `UPDATE employee_reactivation_requests SET reminder_count = reminder_count + 1, last_reminder_at = NOW() WHERE id = ?`,
        [row.id],
      );
      if (ok) out.reminded++; else out.failed++;
    }

    // Escalate once, after 5 days. The claim row is the once-only guard.
    const [stale] = await exec.execute<RowDataPacket[]>(
      `SELECT r.id FROM employee_reactivation_requests r
         LEFT JOIN rejoin_request_escalation x ON x.request_id = r.id
        WHERE r.status = 'pending' AND r.created_at >= ?
          AND r.created_at <= DATE_SUB(NOW(), INTERVAL ? DAY)
          AND x.request_id IS NULL
        ORDER BY r.created_at LIMIT ${MAX_PER_RUN}`,
      [ROLLOUT_AT, ESCALATE_AFTER_DAYS],
    );
    for (const row of stale) {
      const [claim] = await exec.execute<any>(`INSERT IGNORE INTO rejoin_request_escalation (request_id) VALUES (?)`, [row.id]);
      if (Number((claim as any)?.affectedRows ?? 0) !== 1) continue; // another worker got it
      try {
        if (await deps.notifyEscalation(String(row.id))) out.escalated++; else out.failed++;
      } catch (err) {
        out.failed++;
        // The claim stays: a half-delivered escalation is not retried into duplicates.
        console.error(`[RejoinReminder] escalation ${row.id}:`, err instanceof Error ? err.message : err);
      }
    }
  } catch (err) {
    console.error("[RejoinReminder] sweep failed:", err instanceof Error ? err.message : err);
  }
  return out;
}

async function sweep(): Promise<void> {
  if (!(await isWorkerEnabled(WORKER_NAME))) return;
  await withWorkerLock(WORKER_NAME, async () => {
    await recordWorkerRun(WORKER_NAME, "started").catch(() => undefined);
    try {
      const res = await runRejoinReminderSweep(db as unknown as SqlExecutor, {
        notifyReminder: notifyRejoinReminder,
        notifyEscalation: notifyRejoinEscalation,
      });
      await markWorkerRun(WORKER_NAME).catch(() => undefined);
      await recordWorkerRun(WORKER_NAME, "completed", { ...res }).catch(() => undefined);
    } catch (err) {
      await recordWorkerRun(WORKER_NAME, "failed", { error: err instanceof Error ? err.message : String(err) }).catch(() => undefined);
    }
  });
}

export function startRejoinPendingReminderWorker(): void {
  if (intervalRef) return;
  startupRef = setTimeout(() => { void sweep(); }, STARTUP_DELAY_MS);
  intervalRef = setInterval(() => { void sweep(); }, CHECK_INTERVAL_MS);
  registerTimer(WORKER_NAME, intervalRef);
  console.log(`[RejoinReminder] started — sweeping hourly, first run in ${STARTUP_DELAY_MS / 60000}m`);
}

export function stopRejoinPendingReminderWorker(): void {
  if (startupRef) { clearTimeout(startupRef); startupRef = undefined; }
  if (intervalRef) {
    clearInterval(intervalRef);
    unregisterTimer(WORKER_NAME);
    intervalRef = undefined;
    console.log("[RejoinReminder] stopped");
  }
}
