import { env } from "../../config/env.js";
import { withWorkerLock, recordWorkerRun } from "../../workers/worker-utils.js";
import { attendanceReconciliationService } from "./attendance-reconciliation.service.js";
import { runAttendanceMismatchBranchDigest } from "./attendance-mismatch-branch-digest.service.js";

const WORKER_NAME = "ncosec-attendance-reconciliation";

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
    const result = await runAttendanceReconciliationOnce();
    console.log(
      `[${WORKER_NAME}] from=${result.from} to=${result.to} issues=${result.detectedIssues} resolved=${result.resolvedIssues} autoFix=${result.autoFix.status}`
    );
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
