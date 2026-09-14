import { mobilityService } from "../modules/mobility/mobility.service.js";

/**
 * Applies approved transfers whose effective_date has arrived.
 *
 * mobilityService.applyPendingTransfers() existed but was called by nothing — no route, no
 * worker, no cron — so a future-dated transfer was approved and then silently never took
 * effect. An immediate transfer (effective_date <= today) applies inline at approval, which
 * is the common case and always worked; anything post-dated did not.
 *
 * Business decision, taken 2026-08-15: approved does NOT mean applied. A transfer waits at
 * its approved state and the employee moves ON the effective date, so rosters, approval
 * routing and payroll scope stay correct right up to the move. This worker is what makes
 * that true.
 *
 * Safety comes from the service, not from here: applyPendingTransfers claims each row with
 * an expected-state UPDATE (`SET applied_at = NOW() WHERE id = ? AND applied_at IS NULL`)
 * and checks affectedRows, so two overlapping runs cannot move the same employee twice, and
 * it releases the claim if the apply throws so the transfer retries rather than being marked
 * done. That makes this worker safe to run on more than one process and safe to re-run.
 *
 * Daily rather than hourly: effective_date is a DATE, so applying once after midnight is
 * exactly as timely as applying every hour, with a fraction of the employee-master writes.
 */

const RUN_HOUR = 1; // 01:00 local — after midnight so an effective_date of today is due,
                    // and before the 02:00 access-expiry sweep and the payroll jobs.
let nextRun: NodeJS.Timeout | undefined;
let running = false;

export function millisecondsUntilNextTransferSweep(now = new Date()): number {
  const next = new Date(now);
  next.setHours(RUN_HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

export async function runPendingTransferSweep(): Promise<{ applied: number }> {
  // Overlap guard for this process. Cross-process safety is the service's row claim.
  if (running) {
    console.warn("[mobility-transfer] previous sweep still running — skipping this tick");
    return { applied: 0 };
  }
  running = true;
  try {
    const applied = await mobilityService.applyPendingTransfers();
    if (applied > 0) {
      console.log(`[mobility-transfer] applied ${applied} deferred transfer(s)`);
    }
    return { applied };
  } finally {
    running = false;
  }
}

function scheduleNext(): void {
  nextRun = setTimeout(async () => {
    try {
      await runPendingTransferSweep();
    } catch (err) {
      // Never let a failed sweep kill the schedule — an unscheduled worker is how this
      // feature came to be inert in the first place.
      console.error("[mobility-transfer] sweep failed:", err);
    }
    scheduleNext();
  }, millisecondsUntilNextTransferSweep());
}

export function startMobilityTransferWorker(): void {
  if (nextRun) return;
  scheduleNext();
  console.log(`[mobility-transfer] scheduled — next run in ${Math.round(millisecondsUntilNextTransferSweep() / 60000)} min`);
}

export function stopMobilityTransferWorker(): void {
  if (nextRun) {
    clearTimeout(nextRun);
    nextRun = undefined;
  }
}
