/**
 * Process Dashboard alerts worker -- evaluates every enabled alert rule against the dashboard's own dataset, fires anomaly rules, and sends due digests.
 * Follows the repo worker pattern (quality-gap-detector): worker_config kill switch (unmanaged = enabled), advisory lock, registerTimer, recordWorkerRun.
 * Safe to run repeatedly: one event per (rule, data date) is enforced by a UNIQUE key, cooldown gates re-notification, digests are slot-checked.
 * Registered in BOTH workers/all-workers.ts and server.ts (see worker-registration-parity.contract.test.ts).
 */
import { isWorkerEnabled, markWorkerRun } from "../../../shared/worker-config.js";
import { withWorkerLock, registerTimer, unregisterTimer, recordWorkerRun } from "../../../workers/worker-utils.js";
import { runAlertSweep, runDigestSweep } from "./alerts.service.js";

export const WORKER_NAME = "process-dashboard-alerts";
const POLL_MS = 15 * 60 * 1000;
const STARTUP_DELAY_MS = 150_000;

export async function tick(): Promise<void> {
  if (!(await isWorkerEnabled(WORKER_NAME))) return;
  await withWorkerLock(WORKER_NAME, async () => {
    const started = Date.now();
    const alerts = await runAlertSweep();
    const digests = await runDigestSweep();
    await markWorkerRun(WORKER_NAME);
    await recordWorkerRun(WORKER_NAME, "completed", { ...alerts, digestsDue: digests.due, digestsSent: digests.sent, digestErrors: digests.errors, duration_ms: Date.now() - started });
    if (alerts.fired > 0 || digests.sent > 0) console.log(`[${WORKER_NAME}] ${alerts.fired} alert(s) fired, ${alerts.notified} notified, ${digests.sent} digest(s) sent`);
  });
}

let startupTimer: NodeJS.Timeout | null = null;
let intervalTimer: NodeJS.Timeout | null = null;

export function startProcessDashboardAlertsWorker(): void {
  startupTimer = setTimeout(() => {
    void tick().catch((err) => console.error(`[${WORKER_NAME}]`, (err as Error).message));
    intervalTimer = setInterval(() => void tick().catch((err) => console.error(`[${WORKER_NAME}]`, (err as Error).message)), POLL_MS);
    registerTimer(`${WORKER_NAME}-interval`, intervalTimer);
  }, STARTUP_DELAY_MS);
  registerTimer(`${WORKER_NAME}-startup`, startupTimer);
  console.log(`[${WORKER_NAME}] scheduled — every ${POLL_MS / 60000}m`);
}

export function stopProcessDashboardAlertsWorker(): void {
  if (startupTimer) { clearTimeout(startupTimer); unregisterTimer(`${WORKER_NAME}-startup`); startupTimer = null; }
  if (intervalTimer) { clearInterval(intervalTimer); unregisterTimer(`${WORKER_NAME}-interval`); intervalTimer = null; }
  console.log(`[${WORKER_NAME}] stopped`);
}
