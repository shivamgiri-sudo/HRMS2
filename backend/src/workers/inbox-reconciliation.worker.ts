/**
 * Inbox reconciliation worker.
 *
 * Runs the resolution rules on a timer so an alert whose work is finished
 * stops chasing the user even when the completing code path never told the
 * inbox about it — an import, a legacy screen, a route added later, or simply
 * a service we have not wired yet.
 *
 * The approve/submit handlers close their own alerts directly and instantly;
 * this is the safety net behind them, not the primary mechanism.
 */

import { runInboxReconciliation } from "../modules/inbox/inbox-reconciliation.js";

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
/** Let the API warm up before the first sweep touches the DB. */
const STARTUP_DELAY_MS = 45 * 1000;

let startupRef: ReturnType<typeof setTimeout> | undefined;
let intervalRef: ReturnType<typeof setInterval> | undefined;
let running = false;

async function sweep(): Promise<void> {
  if (running) {
    console.log("[inbox-reconciliation] previous sweep still running; skipping");
    return;
  }
  running = true;
  try {
    const result = await runInboxReconciliation();
    if (result.total > 0) {
      const detail = Object.entries(result.byRule)
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${k}=${n}`)
        .join(" ");
      console.log(`[inbox-reconciliation] closed ${result.total} resolved alert(s): ${detail}`);
    }
  } catch (error) {
    console.error(
      "[inbox-reconciliation] sweep failed:",
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    running = false;
  }
}

export function startInboxReconciliationWorker(): void {
  if (intervalRef) return;
  console.log(`[inbox-reconciliation] Starting — interval: ${CHECK_INTERVAL_MS / 60000}min`);
  startupRef = setTimeout(() => { void sweep(); }, STARTUP_DELAY_MS);
  intervalRef = setInterval(() => { void sweep(); }, CHECK_INTERVAL_MS);
}

export function stopInboxReconciliationWorker(): void {
  if (startupRef) {
    clearTimeout(startupRef);
    startupRef = undefined;
  }
  if (intervalRef) {
    clearInterval(intervalRef);
    intervalRef = undefined;
  }
  console.log("[inbox-reconciliation] Stopped");
}

export { sweep as runInboxReconciliationSweep };
