// Keeps attendance records complete without anyone having to notice a gap.
//
// WHY THIS EXISTS: the nightly engine (attendance-engine.cron.ts) runs once, at 23:00, for yesterday only, on
// an in-process timer. This process restarts every few minutes under the deploy cadence, so a restart (or a
// deploy) at that moment skipped or cut the run, and no later run went back to finish it. Holes stayed forever.
//
// WHAT IT DOES: finds active staff with NO record in the last 7 complete days and creates them with the same
// engine. It is cheap when nothing is missing (one query), so it runs shortly after every start, every 6
// hours, and straight after the nightly sweep. Never writes over an existing or locked record.
import { withWorkerLock, recordWorkerRun } from "../../workers/worker-utils.js";
import { logger } from "../../logger.js";
import { runAutomaticHeal } from "./attendance-heal.service.js";

export const HEAL_WORKER_NAME = "attendance-engine-heal";
const STARTUP_DELAY_MS = 2 * 60 * 1000;
const EVERY_MS = 6 * 60 * 60 * 1000;

let startupTimer: NodeJS.Timeout | undefined;
let intervalTimer: NodeJS.Timeout | undefined;

export async function runHealOnce(): Promise<void> {
  await withWorkerLock(HEAL_WORKER_NAME, async () => {
    await recordWorkerRun(HEAL_WORKER_NAME, "started");
    try {
      const r = await runAutomaticHeal();
      await recordWorkerRun(HEAL_WORKER_NAME, "completed", { found: r.found, processed: r.processed, failed: r.failed, truncated: r.truncated, stale: r.stale ?? null });
      if (r.stale?.regraded) logger.info({ ...r.stale }, "[attendance-heal] re-graded days whose evidence arrived late");
      if (r.found > 0) logger.info({ found: r.found, processed: r.processed, failed: r.failed }, "[attendance-heal] filled missing attendance records");
    } catch (err) {
      await recordWorkerRun(HEAL_WORKER_NAME, "failed", { error: err instanceof Error ? err.message : String(err) });
      logger.error({ err: (err as Error).message }, "[attendance-heal] run failed");
    }
  });
}

export function startAttendanceHealWorker(): void {
  if (startupTimer || intervalTimer || process.env.ATTENDANCE_HEAL_ENABLED === "false") return;
  startupTimer = setTimeout(() => { void runHealOnce(); }, STARTUP_DELAY_MS);
  startupTimer.unref();
  intervalTimer = setInterval(() => { void runHealOnce(); }, EVERY_MS);
  intervalTimer.unref();
}

export function stopAttendanceHealWorker(): void {
  if (startupTimer) clearTimeout(startupTimer);
  if (intervalTimer) clearInterval(intervalTimer);
  startupTimer = undefined;
  intervalTimer = undefined;
}
