import { env } from "../../config/env.js";
import { withWorkerLock, recordWorkerRun } from "../../workers/worker-utils.js";
import { attendanceReconciliationService } from "./attendance-reconciliation.service.js";
import { runAttendanceMismatchBranchDigest } from "./attendance-mismatch-branch-digest.service.js";
import { resolveFilledGaps } from "./attendance-heal.service.js";
import { cosecSyncService } from "./cosec-sync.service.js";

const WORKER_NAME = "ncosec-attendance-reconciliation";
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istDateString(date: Date): string {
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

let nextRun: NodeJS.Timeout | undefined;

function millisecondsUntilNextHour(hour: number, now = new Date()): number {
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

export async function runAttendanceReconciliationOnce(options: { autoFix?: boolean } = {}) {
  await recordWorkerRun(WORKER_NAME, "started", {
    autoFix: options.autoFix ?? env.NCOSEC_RECONCILIATION_AUTO_FIX,
    lookbackDays: env.NCOSEC_RECONCILIATION_LOOKBACK_DAYS,
  });

  try {
    const result = await attendanceReconciliationService.auditDefaultWindow({
      autoFix: options.autoFix ?? env.NCOSEC_RECONCILIATION_AUTO_FIX,
    });
    await recordWorkerRun(WORKER_NAME, "completed", result as unknown as Record<string, unknown>);
    return result;
  } catch (error) {
    await recordWorkerRun(WORKER_NAME, "failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function execute() {
  if (!env.NCOSEC_RECONCILIATION_ENABLED) return;
  const ran = await withWorkerLock(WORKER_NAME, async () => {
    // Re-attribute night shifts over the same lookback window, before the completeness audit
    // below. `attendanceReconciliationService.audit()` groups COSEC punches by plain calendar
    // date (pullSourceGroups) with no night-shift awareness at all — it checks for a different
    // class of problem (unmapped users, missing records) and was never going to catch a shift
    // whose exit landed on the next calendar day getting truncated. That attribution only ever
    // lived in the live sync's 1-2 day lookback, so a shift it missed stayed wrong forever once
    // it aged out of that window. Running the same shift-aware sync here, every night, over the
    // full reconciliation window is what actually closes that gap — not a one-off manual rebuild.
    const to = istDateString(new Date());
    const from = istDateString(new Date(Date.now() - env.NCOSEC_RECONCILIATION_LOOKBACK_DAYS * 86400000));
    try {
      const syncResult = await cosecSyncService.sync({ from, to });
      console.log(
        `[${WORKER_NAME}] night-shift resync ${from}..${to}: migrated=${syncResult.migratedDays} unchanged=${syncResult.skippedUnchanged} failed=${syncResult.failed.length}`
      );
    } catch (error) {
      console.error(`[${WORKER_NAME}] night-shift resync failed:`, error instanceof Error ? error.message : String(error));
    }

    const result = await runAttendanceReconciliationOnce();
    console.log(
      `[${WORKER_NAME}] from=${result.from} to=${result.to} issues=${result.detectedIssues} resolved=${result.resolvedIssues} autoFix=${result.autoFix.status}`
    );
    // Close "missing attendance record" items whose record now exists, whatever their age (the audit window
    // is only 7 days, so older ones could never clear themselves).
    try {
      const closed = await resolveFilledGaps();
      if (closed > 0) console.log(`[${WORKER_NAME}] closed ${closed} filled gap item(s)`);
    } catch (error) {
      console.error(`[${WORKER_NAME}] closing filled gaps failed:`, error instanceof Error ? error.message : String(error));
    }
    // Follow-up step in the same run: digest the *currently* open backlog (not just what
    // this run just wrote) into one Work Inbox item per branch. Isolated in its own
    // try/catch so a digest failure never turns a successful reconciliation run into a
    // reported failure.
    try {
      await runAttendanceMismatchBranchDigest();
    } catch (error) {
      console.error(`[${WORKER_NAME}] branch digest failed:`, error instanceof Error ? error.message : String(error));
    }
  });
  if (!ran) console.log(`[${WORKER_NAME}] skipped because another instance owns the lock`);
}

export function startAttendanceReconciliationWorker(): void {
  if (nextRun || !env.NCOSEC_RECONCILIATION_ENABLED) return;
  const scheduleNext = () => {
    nextRun = setTimeout(async () => {
      try {
        await execute();
      } catch (error) {
        console.error(`[${WORKER_NAME}] failed`, error instanceof Error ? error.message : String(error));
      } finally {
        nextRun = undefined;
        scheduleNext();
      }
    }, millisecondsUntilNextHour(env.NCOSEC_RECONCILIATION_HOUR));
    nextRun.unref();
  };

  scheduleNext();
  console.log(
    `[${WORKER_NAME}] scheduled daily hour=${env.NCOSEC_RECONCILIATION_HOUR} lookbackDays=${env.NCOSEC_RECONCILIATION_LOOKBACK_DAYS} autoFix=${env.NCOSEC_RECONCILIATION_AUTO_FIX}`
  );
}

export function stopAttendanceReconciliationWorker(): void {
  if (!nextRun) return;
  clearTimeout(nextRun);
  nextRun = undefined;
}
