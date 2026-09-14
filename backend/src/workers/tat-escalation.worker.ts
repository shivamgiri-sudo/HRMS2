/**
 * TAT escalation worker — drives the escalation engine that has existed, broken, since
 * sql/294_tat_escalation_matrix.sql shipped.
 *
 * Safety is the whole design here, because this worker's first run is the single most
 * storm-prone moment in the notification build: there are months of overdue tasks in
 * task_tat_instance, and a naive query finds all of them at once. That is the exact shape
 * of the incident where official-email-compliance.worker.ts emitted 43,943 duplicate
 * alerts.
 *
 * Four independent guards, any one of which is sufficient:
 *   1. backfill floor  — notification_event_config.backfill_floor_at, armed to NOW() by
 *                        migration 1022. Anything that came due before the migration is
 *                        INVISIBLE to the query, not throttled.
 *   2. worker kill switch — worker_config.enabled, seeded 0 by migration 1023.
 *   3. shadow mode     — events ship dispatch_mode='shadow'; the gateway resolves and
 *                        claims but does not deliver.
 *   4. caps + DB dedupe — max_per_run here, uq_tel_level and uq_ndc_dedupe in the schema.
 *
 * Registered in BOTH all-workers.ts and server.ts. Registering in only one is how
 * ats-reminders.cron.ts came to never run in production.
 */
import type { RowDataPacket } from 'mysql2';
import { db } from '../db/mysql.js';
import { findDueEscalations, recordEscalation, markBreached } from '../modules/governance/tat.service.js';
import type { DueEscalation } from '../modules/governance/tat.service.js';
import { notificationGateway } from '../modules/communication/notification.gateway.js';
import { triggerTatBreach } from '../modules/work-inbox/work-inbox.triggers.js';
import { isWorkerEnabled, markWorkerRun } from '../shared/worker-config.js';
import { withWorkerLock, registerTimer, unregisterTimer, recordWorkerRun } from './worker-utils.js';

const WORKER_NAME = 'tat-escalation';
const POLL_MS = 15 * 60 * 1000;   // 15 minutes — SLAs are measured in hours
const STARTUP_DELAY_MS = 90_000;  // let the API settle before the first sweep
const MAX_PER_RUN = 50;

/** Escalation level -> catalogue event code. */
function eventCodeFor(level: number): string {
  if (level <= 1) return 'task_sla_breach_l1';
  if (level === 2) return 'task_sla_breach_l2';
  return 'task_sla_breach_l3';
}

/**
 * The floor before which nothing is visible.
 *
 * Read from the event registry rather than hardcoded, so widening it is an operator
 * action (one UPDATE, reversible, auditable) rather than a deploy. If the registry is
 * missing or the row has no floor, fall back to 7 days — never "all history".
 */
async function backfillFloor(): Promise<Date> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT MIN(backfill_floor_at) AS floor
         FROM notification_event_config
        WHERE event_code IN ('task_sla_breach_l1','task_sla_breach_l2','task_sla_breach_l3')
          AND backfill_floor_at IS NOT NULL`,
    );
    const f = rows[0]?.floor;
    if (f) return new Date(f);
  } catch { /* registry not migrated yet */ }
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
}

export async function runTatEscalationSweep(): Promise<{
  scanned: number; escalated: number; skipped: number; remaining: number;
}> {
  const floor = await backfillFloor();
  const due = await findDueEscalations({ backfillFloor: floor, limit: MAX_PER_RUN + 1 });

  // Ask for one more than the cap so the leftover can be reported rather than silently
  // dropped — sla-breach-worker.ts:21 caps at 10 with no record of what it skipped.
  const remaining = Math.max(0, due.length - MAX_PER_RUN);
  const batch = due.slice(0, MAX_PER_RUN);

  let escalated = 0;
  let skipped = 0;

  for (const esc of batch) {
    try {
      // Claim the level FIRST. If another worker already logged it, stop — do not notify.
      const claimed = await recordEscalation(esc);
      if (!claimed) { skipped++; continue; }

      await markBreached(esc.tatInstanceId);

      // TAT_BREACH was a registered Work Inbox item_type with zero producers anywhere in
      // the app (delta-audit 2026-08-14, Stage 7b, user-approved) — triggerTatBreach()
      // existed, fully written, but nothing called it. This is the one place a TAT
      // instance is confirmed to have actually breached (markBreached just above), so it's
      // the correct trigger point. createWorkItemIfNotExists dedupes on
      // (entityType, entityId, itemType, status='pending'), so polling this worker every
      // 15 minutes does not create a second pending item for the same instance.
      await triggerTatBreach(esc.tatInstanceId, esc.taskType, esc.entityId, esc.notifyRole ?? undefined)
        .catch((err) => console.error(`[${WORKER_NAME}] work-item creation failed for ${esc.tatInstanceId}:`, (err as Error).message));

      const result = await notificationGateway.notify({
        eventCode: eventCodeFor(esc.escalationLevel),
        // Level in the key: each level is a separate, legitimate notification, but each
        // must happen exactly once no matter how often the worker polls.
        dedupeKey: `task_tat_instance:${esc.tatInstanceId}:level${esc.escalationLevel}`,
        context: {
          employeeId: esc.assignedTo,
          userId: esc.ownerUserId,
          branchId: esc.branchId,
          processId: esc.processId,
          tatInstanceId: esc.tatInstanceId,
        },
        entityType: 'task_tat_instance',
        entityId: esc.tatInstanceId,
        data: {
          task_type: esc.taskType,
          entity_type: esc.entityType,
          entity_id: esc.entityId,
          due_at: esc.dueAt,
          // analytics strip
          hours_overdue: esc.hoursOverdue,
          escalation_level: esc.escalationLevel,
          notify_role: esc.notifyRole,
        },
        correlationId: `tat:${esc.tatInstanceId}`,
      });

      if (result.outcome === 'sent' || result.outcome === 'shadow') escalated++;
      else skipped++;
    } catch (err) {
      // One bad instance must not abort the sweep: the next poll retries it, and the
      // escalation log row already written stops it double-notifying.
      skipped++;
      console.error(`[${WORKER_NAME}] instance ${esc.tatInstanceId} level ${esc.escalationLevel}:`,
        (err as Error).message);
    }
  }

  return { scanned: batch.length, escalated, skipped, remaining };
}

async function tick(): Promise<void> {
  if (!(await isWorkerEnabled(WORKER_NAME))) return;

  await withWorkerLock(WORKER_NAME, async () => {
    const started = Date.now();
    const stats = await runTatEscalationSweep();
    await markWorkerRun(WORKER_NAME);
    await recordWorkerRun(WORKER_NAME, 'completed', {
      ...stats,
      duration_ms: Date.now() - started,
    });
    if (stats.remaining > 0) {
      // Visible backlog, not silent truncation.
      console.warn(`[${WORKER_NAME}] CAP_REACHED — ${stats.remaining} escalations deferred to the next run`);
    }
  });
}

let startupTimer: NodeJS.Timeout | null = null;
let intervalTimer: NodeJS.Timeout | null = null;

export function startTatEscalationWorker(): void {
  startupTimer = setTimeout(() => {
    void tick();
    intervalTimer = setInterval(() => void tick(), POLL_MS);
    registerTimer(`${WORKER_NAME}-interval`, intervalTimer);
  }, STARTUP_DELAY_MS);
  registerTimer(`${WORKER_NAME}-startup`, startupTimer);
  console.log(`[${WORKER_NAME}] scheduled — every ${POLL_MS / 60000}m (disabled by default via worker_config)`);
}

export function stopTatEscalationWorker(): void {
  if (startupTimer) { clearTimeout(startupTimer); unregisterTimer(`${WORKER_NAME}-startup`); startupTimer = null; }
  if (intervalTimer) { clearInterval(intervalTimer); unregisterTimer(`${WORKER_NAME}-interval`); intervalTimer = null; }
  console.log(`[${WORKER_NAME}] stopped`);
}
