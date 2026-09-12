/**
 * Employee Master snapshot refresh — scheduled job.
 *
 * Keeps employee_master_snapshot (migration 1615) in sync by re-running
 * refreshEmployeeMasterSnapshot() on a fixed interval. Same self-rescheduling setTimeout
 * pattern as cron/business-action-sync.cron.ts — see that file for the convention this
 * follows.
 *
 * Interval: every 30 minutes. db_bill (the slower of the two sources this pulls from) only
 * changes on manual HR edits, not in real time, so half-hourly is comfortably fresh without
 * adding meaningful load — the underlying query already runs in well under a minute for the
 * full ~59k-employee population.
 */
import { refreshEmployeeMasterSnapshot } from "../modules/reporting/employee-master-snapshot.service.js";

const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

let scheduler: NodeJS.Timeout | undefined;
let refreshInFlight = false;

function scheduleNext(delayMs: number): void {
  scheduler = setTimeout(runRefresh, delayMs);
  scheduler.unref();
}

async function runRefresh(): Promise<void> {
  // Guards against a slow run overlapping its own next tick — shouldn't happen at 30-minute
  // spacing given the job normally finishes in well under a minute, but a stalled db_bill
  // connection could in principle make one run long enough to collide with the next.
  if (refreshInFlight) {
    console.warn("[CRON] employee-master-snapshot refresh already in flight, skipping this tick");
    scheduleNext(REFRESH_INTERVAL_MS);
    return;
  }

  refreshInFlight = true;
  console.log("[CRON] Running employee-master-snapshot refresh...");
  try {
    const result = await refreshEmployeeMasterSnapshot();
    console.log(
      `[CRON] employee-master-snapshot refresh complete: ${result.rowsWritten}/${result.rowsFetched} rows written in ${result.durationMs}ms`
    );
  } catch (error) {
    console.error("[CRON] employee-master-snapshot refresh error:", error);
  } finally {
    refreshInFlight = false;
    scheduler = undefined;
    scheduleNext(REFRESH_INTERVAL_MS);
  }
}

export function startEmployeeMasterSnapshotScheduler(): void {
  if (scheduler) return;
  console.log("[CRON] Employee-master-snapshot scheduler starting (every 30 minutes)");
  // First run shortly after boot, not instantly — lets the rest of server startup (DB pool
  // warm-up, other cron init) settle first, same offset business-action-sync.cron.ts's own
  // jobs effectively get by being one of several inits in sequence.
  scheduleNext(60_000);
}

export function stopEmployeeMasterSnapshotScheduler(): void {
  if (scheduler) clearTimeout(scheduler);
  scheduler = undefined;
  console.log("[CRON] Employee-master-snapshot scheduler stopped");
}
