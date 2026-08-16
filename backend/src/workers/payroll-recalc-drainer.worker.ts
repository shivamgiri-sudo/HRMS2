import type { RowDataPacket } from "mysql2";
import { db } from "../db/mysql.js";
import { drainPayrollRecalcQueue } from "../modules/payroll/payroll-recalc-drainer.service.js";
import { logger } from "../lib/logger.js";
import { withWorkerLock, registerTimer, unregisterTimer } from "./worker-utils.js";

const WORKER_NAME = "payroll-recalc-drainer";

/** How often to look for pending recalculations. */
const TICK_MS = 15 * 60 * 1000;

/**
 * Batches per month per tick. drainPayrollRecalcQueue handles 200 rows per call, so this clears up
 * to 2,000 per month per tick — enough to absorb a large COSEC sync within one tick, while still
 * bounding how much payroll recalculation one tick can trigger.
 */
const MAX_BATCHES_PER_MONTH = 10;

let scheduledTimer: NodeJS.Timeout | null = null;

/**
 * Drain payroll_recalculation_queue on a schedule.
 *
 * WHY THIS EXISTS
 * drainPayrollRecalcQueue processes at most 200 rows per call, does not loop, and had exactly one
 * caller: the tail of cosec-sync.service.ts, inside a try/catch that downgrades any failure to
 * "sync result unaffected". So the queue drained only as a side effect of an unrelated job, 200 at
 * a time, and a single COSEC sync could enqueue far more than one drain removes. It backlogged by
 * construction.
 *
 * Measured live 2026-08-16: 912 pending requests for 270 ACTIVE employees, oldest 12 days, nothing
 * drained since 2026-08-12. Those employees' salary_prep_line rows were stale against attendance
 * that had since changed. Rows sourced from attendance_regularization had no drain path at all
 * except incidentally, when a COSEC sync happened to run for the same month.
 *
 * payroll-nightly-recalc.worker.ts is NOT this, despite the name — it recalculates whole open runs
 * for the current month and never reads this queue.
 *
 * SAFETY
 * This cannot alter a closed run. recalculateOpenPayrollForEmployee acts only on runs in draft or
 * processing and returns skipped_locked otherwise, which the drainer records rather than retries.
 * So a locked, disbursed or finalized run is never recalculated by this worker — the backlog
 * clears only where recalculation was legitimate and simply never happened.
 */
async function drainAllPendingMonths(): Promise<void> {
  // Every month with pending work, not just the current one: the 11 attendance_regularization
  // rows found in the backlog spanned months the COSEC path would never have visited.
  const [monthRows] = await db.execute<RowDataPacket[]>(
    `SELECT DATE_FORMAT(payroll_month, '%Y-%m') AS month, COUNT(*) AS pending
       FROM payroll_recalculation_queue
      WHERE status = 'pending'
      GROUP BY DATE_FORMAT(payroll_month, '%Y-%m')
      ORDER BY month ASC`,
  );

  const months = monthRows as Array<{ month: string; pending: number }>;
  if (months.length === 0) return;

  for (const { month, pending } of months) {
    let batches = 0;
    let totalProcessed = 0;
    let totalFailed = 0;
    let totalSkipped = 0;

    // Never drain more than was already waiting when this tick began.
    //
    // Draining is SELF-FEEDING. recalculateOpenPayrollForEmployee re-queues a fresh pending row
    // whenever it cannot recalculate — when no salary_prep_line exists for the employee/month, and
    // when every run for the month is closed — so that the divergence is recorded rather than
    // lost. The drainer then marks the original skipped_locked. Net effect: one row out, one row
    // in, forever.
    //
    // "Stop when nothing moved" cannot see this, because rows genuinely do move on every pass.
    // Observed live 2026-08-16: pending_at_start 11 produced skipped_locked 110 — the same eleven
    // rows cycled ten times until the batch cap stopped it. A single call per COSEC sync hid this
    // for as long as that was the only caller; looping exposed it immediately.
    //
    // Bounding by the starting backlog is what actually terminates. Anything re-queued during this
    // tick is next tick's work, which is also the honest reading: it did not get done.
    const startingBacklog = Number(pending);
    let moved = 0;

    while (batches < MAX_BATCHES_PER_MONTH && moved < startingBacklog) {
      const result = await drainPayrollRecalcQueue(month);
      const movedThisBatch = result.processed + result.failed + result.skipped_locked;

      totalProcessed += result.processed;
      totalFailed += result.failed;
      totalSkipped += result.skipped_locked;
      moved += movedThisBatch;
      batches++;

      // Still needed alongside the backlog bound: a row can be read as pending and then claimed by
      // another drainer between the SELECT and the UPDATE, so a batch can legitimately move
      // nothing while rows remain pending. Keying on rows-seen would spin against exactly those.
      if (movedThisBatch === 0) break;
    }

    logger.info(
      { month, pending_at_start: Number(pending), batches, processed: totalProcessed, failed: totalFailed, skipped_locked: totalSkipped },
      `[${WORKER_NAME}] drained ${month}`,
    );

    if (batches >= MAX_BATCHES_PER_MONTH) {
      // Say so rather than let a silent cap look like a completed drain.
      logger.warn(
        { month, batches },
        `[${WORKER_NAME}] hit the per-tick batch cap for ${month}; remaining entries will drain on the next tick`,
      );
    }

    // Re-queue outpacing the drain is worth naming. It is not an error — recording an
    // unrecalculable divergence is deliberate — but a month that only ever skips is a month with
    // no open run to write to, and no amount of draining will change that. Left silent, the queue
    // looks busy forever while nothing is actually being recalculated.
    if (totalProcessed === 0 && totalSkipped > 0) {
      logger.warn(
        { month, skipped_locked: totalSkipped, processed: 0 },
        `[${WORKER_NAME}] ${month}: every entry skipped, none recalculated — no open run for this month, so these re-queue as fast as they drain`,
      );
    }
  }
}

async function tick(): Promise<void> {
  const executed = await withWorkerLock(WORKER_NAME, drainAllPendingMonths);
  if (!executed) {
    logger.debug(`[${WORKER_NAME}] skipped — another instance holds the lock`);
  }
}

export function startPayrollRecalcDrainerWorker(): void {
  if (scheduledTimer) return;
  scheduledTimer = setInterval(() => {
    tick().catch((err: unknown) => {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, `[${WORKER_NAME}] tick failed`);
    });
  }, TICK_MS);
  registerTimer(WORKER_NAME, scheduledTimer);
  logger.info(`[${WORKER_NAME}] started — draining payroll_recalculation_queue every ${TICK_MS / 60000} min`);
}

export function stopPayrollRecalcDrainerWorker(): void {
  if (scheduledTimer) {
    clearInterval(scheduledTimer);
    unregisterTimer(WORKER_NAME);
    scheduledTimer = null;
  }
}
