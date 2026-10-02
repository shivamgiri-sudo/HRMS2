// Scheduler for the Roster Requests hub sweeps:
//   - auto-approve sweep every 5 minutes (catches requests that became eligible after they were
//     raised, e.g. once the swap counterpart accepted, and anything an event trigger missed);
//   - SLA escalation sweep every 30 minutes.
//
// Off by default, like the roster-upload-escalation scheduler it is modelled on:
//   ROSTER_REQUESTS_CRON_ENABLED=true   register the timers (otherwise a no-op)
// Registered in server.ts (API process, behind ENABLE_SCHEDULERS and !WORKERS_EXTERNAL) and in
// workers/all-workers.ts — exactly one of the two runs it in any topology.
//
// Double-run safety: each sweep has an in-process running flag so a slow tick never overlaps the
// next one; across processes, escalations are claimed with INSERT IGNORE before notifying, and an
// auto-approval goes through decide, whose services refuse an already-decided request (swap: row
// lock + status check; week-off: status pre-check).
import { logger } from '../../logger.js';
import { sweepAutoApprove } from './roster-requests.auto.js';
import { runEscalationSweep } from './roster-requests.escalation.js';

export const AUTO_APPROVE_INTERVAL_MS = 5 * 60 * 1000;
export const ESCALATION_INTERVAL_MS = 30 * 60 * 1000;

let autoTimer: NodeJS.Timeout | undefined;
let escalationTimer: NodeJS.Timeout | undefined;
let autoRunning = false;
let escalationRunning = false;

const isEnabled = (): boolean => process.env.ROSTER_REQUESTS_CRON_ENABLED === 'true';

export async function runAutoApproveTick(): Promise<void> {
  if (autoRunning) return;
  autoRunning = true;
  try {
    const r = await sweepAutoApprove();
    if (r.checked > 0) logger.info(r, '[roster-requests] auto-approve sweep finished');
  } catch (err) {
    logger.error({ err: (err as Error).message }, '[roster-requests] auto-approve sweep failed');
  } finally {
    autoRunning = false;
  }
}

export async function runEscalationTick(): Promise<void> {
  if (escalationRunning) return;
  escalationRunning = true;
  try {
    const r = await runEscalationSweep();
    if (r.candidates > 0) logger.info(r, '[roster-requests] escalation sweep finished');
  } catch (err) {
    logger.error({ err: (err as Error).message }, '[roster-requests] escalation sweep failed');
  } finally {
    escalationRunning = false;
  }
}

export function startRosterRequestsScheduler(): void {
  if (!isEnabled() || autoTimer || escalationTimer) return;
  autoTimer = setInterval(() => void runAutoApproveTick(), AUTO_APPROVE_INTERVAL_MS);
  autoTimer.unref();
  escalationTimer = setInterval(() => void runEscalationTick(), ESCALATION_INTERVAL_MS);
  escalationTimer.unref();
  logger.info('[roster-requests] auto-approve and SLA escalation scheduler started');
}

export function stopRosterRequestsScheduler(): void {
  if (autoTimer) clearInterval(autoTimer);
  if (escalationTimer) clearInterval(escalationTimer);
  autoTimer = undefined;
  escalationTimer = undefined;
}
