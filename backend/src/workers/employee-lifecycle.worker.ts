/**
 * Employee Lifecycle Worker
 *
 * Runs five scheduled jobs:
 * 1. Daily activation at 12:01 AM - activates employees whose joining date has arrived
 * 2. Hourly provisioning retry - retries failed provisioning task dispatch
 * 3. Daily AWOL detection at 2:00 AM - flags active employees who have stopped showing
 *    up with no leave applied and no exit filed (see awol-detection.service.ts). Hosted
 *    here rather than as a new dual-registered cron: this worker is already started from
 *    both server.ts and workers/all-workers.ts (see worker-registration-parity.contract.test.ts),
 *    unconditionally once schedulers are enabled, so an AWOL_SUSPECTED work item is a
 *    genuinely new, real-backlog signal that ships default-on without needing its own
 *    server.ts/all-workers.ts registration or an explicit-enable flag.
 * 4. Daily last-working-day scan at 3:00 AM - raises the "LWD approaching" notification,
 *    which carries the open department-clearance count (see exit-lwd-scan.service.ts).
 *    Hosted here for the same reason as the AWOL scan above: it needs to be time-driven,
 *    and this worker is already registered on both sides of the parity contract. The
 *    notification function it calls had existed with zero call sites, so the clearance
 *    signal was computed by nothing and seen by no one.
 * 5. Daily NOC LWD trigger at 8:00 AM - auto-opens a NOC clearance case for every
 *    employee whose confirmed last working day has arrived, sends them their form invite,
 *    and creates a Work Inbox item for the branch HR. Skips revoked/cancelled/withdrawn
 *    exit requests so a resignation reversal never accidentally triggers a clearance chain.
 *    See noc-lwd-trigger.service.ts for the full scenario matrix.
 * 6. Daily exit-clearance LWD trigger at 8:30 AM - creates the 9 exit_clearance_task rows
 *    for every employee whose confirmed last working day has arrived (staggered 30 minutes
 *    after the NOC trigger above so the two don't contend for the pool on the same tick).
 *    See exit-clearance-lwd-trigger.service.ts.
 */

import { runDailyActivationJob } from '../modules/employees/employee-activation.service.js';
import { runProvisioningRetryJob } from '../jobs/provisioning-retry.job.js';
import { runAwolDetectionScan } from '../modules/employees/awol-detection.service.js';
import { runLastWorkingDayScan } from '../modules/exit/exit-lwd-scan.service.js';
import { runNocLwdTrigger } from '../modules/exit/noc-lwd-trigger.service.js';
import { runExitClearanceLwdTrigger } from '../modules/exit/exit-clearance-lwd-trigger.service.js';

let _activationTimer: ReturnType<typeof setTimeout> | null = null;
let _retryTimer: ReturnType<typeof setInterval> | null = null;
let _awolTimer: ReturnType<typeof setTimeout> | null = null;
let _lwdTimer: ReturnType<typeof setTimeout> | null = null;
let _nocTriggerTimer: ReturnType<typeof setTimeout> | null = null;
let _clearanceLwdTriggerTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Calculate milliseconds until next 12:01 AM
 */
function msUntilNextActivationRun(): number {
  const now = new Date();
  const next = new Date();
  next.setDate(now.getDate() + (now.getHours() >= 0 && now.getMinutes() >= 1 ? 1 : 0));
  next.setHours(0, 1, 0, 0); // 12:01 AM
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}

/**
 * Calculate milliseconds until next 2:00 AM.
 *
 * Staggered an hour after activation (12:01 AM) so the two daily jobs don't
 * contend for the DB pool on the same tick.
 */
function msUntilNextLwdScanRun(): number {
  const now = new Date();
  const next = new Date();
  next.setHours(3, 0, 0, 0); // 3:00 AM
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}

function msUntilNextNocTriggerRun(): number {
  const now = new Date();
  const next = new Date();
  next.setHours(8, 0, 0, 0); // 8:00 AM — start of business day
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}

function msUntilNextClearanceLwdTriggerRun(): number {
  const now = new Date();
  const next = new Date();
  next.setHours(8, 30, 0, 0); // 8:30 AM — staggered 30m after the NOC trigger
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}

function msUntilNextAwolScanRun(): number {
  const now = new Date();
  const next = new Date();
  next.setHours(2, 0, 0, 0); // 2:00 AM
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}

async function runActivation(): Promise<void> {
  try {
    const report = await runDailyActivationJob();
    console.log(
      `[employee-lifecycle] Activation job complete: activated=${report.activated.length}` +
      ` errors=${report.errors.length} sla_violations=${report.slaViolations.length}`
    );
    if (report.slaViolations.length > 0) {
      console.warn(
        `[employee-lifecycle] SLA violations:`,
        report.slaViolations.map(v => `${v.employeeCode}/${v.taskCode} overdue ${v.hoursOverdue}h`)
      );
    }
  } catch (err) {
    console.error('[employee-lifecycle] Activation job failed:', err);
  }
  // Schedule next run (24h)
  _activationTimer = setTimeout(runActivation, 24 * 60 * 60 * 1000);
}

async function runAwolScan(): Promise<void> {
  try {
    await runAwolDetectionScan();
  } catch (err) {
    console.error('[employee-lifecycle] AWOL detection scan failed:', err);
  }
  // Schedule next run (24h)
  _awolTimer = setTimeout(runAwolScan, 24 * 60 * 60 * 1000);
}

async function runLwdScan(): Promise<void> {
  try {
    const r = await runLastWorkingDayScan();
    if (r.scanned > 0) {
      console.log(
        `[employee-lifecycle] LWD scan: scanned=${r.scanned} notified=${r.notified} failed=${r.failed}`
      );
    }
  } catch (err) {
    console.error('[employee-lifecycle] Last-working-day scan failed:', err);
  }
  // Schedule next run (24h)
  _lwdTimer = setTimeout(runLwdScan, 24 * 60 * 60 * 1000);
}

async function runNocTrigger(): Promise<void> {
  try {
    const r = await runNocLwdTrigger();
    if (r.scanned > 0) {
      console.log(
        `[employee-lifecycle] NOC LWD trigger: scanned=${r.scanned}` +
        ` created=${r.created} alreadyExisted=${r.alreadyExisted} failed=${r.failed}`
      );
    }
  } catch (err) {
    console.error('[employee-lifecycle] NOC LWD trigger failed:', err);
  }
  // Schedule next run (24h)
  _nocTriggerTimer = setTimeout(runNocTrigger, 24 * 60 * 60 * 1000);
}

async function runClearanceLwdTrigger(): Promise<void> {
  try {
    const r = await runExitClearanceLwdTrigger();
    if (r.scanned > 0) {
      console.log(
        `[employee-lifecycle] Exit-clearance LWD trigger: scanned=${r.scanned}` +
        ` created=${r.created} alreadyExisted=${r.alreadyExisted} failed=${r.failed}`
      );
    }
  } catch (err) {
    console.error('[employee-lifecycle] Exit-clearance LWD trigger failed:', err);
  }
  // Schedule next run (24h)
  _clearanceLwdTriggerTimer = setTimeout(runClearanceLwdTrigger, 24 * 60 * 60 * 1000);
}

async function runRetry(): Promise<void> {
  try {
    const report = await runProvisioningRetryJob();
    if (report.attempted > 0) {
      console.log(
        `[employee-lifecycle] Provisioning retry: attempted=${report.attempted}` +
        ` succeeded=${report.succeeded} failed=${report.failed.length}`
      );
    }
  } catch (err) {
    console.error('[employee-lifecycle] Provisioning retry job failed:', err);
  }
}

export function startEmployeeLifecycleWorker(): void {
  if (_activationTimer || _retryTimer || _awolTimer || _lwdTimer || _nocTriggerTimer || _clearanceLwdTriggerTimer) return;

  // Daily activation at 12:01 AM
  const msUntilFirstRun = msUntilNextActivationRun();
  console.log(
    `[employee-lifecycle] Activation job scheduled in ${Math.round(msUntilFirstRun / 60000)}m ` +
    `(next 12:01 AM)`
  );
  _activationTimer = setTimeout(runActivation, msUntilFirstRun);

  // Hourly provisioning retry
  _retryTimer = setInterval(runRetry, 60 * 60 * 1000);
  runRetry(); // Run immediately on start
  console.log('[employee-lifecycle] Provisioning retry scheduler started (hourly)');

  // Daily AWOL detection scan at 2:00 AM
  const msUntilAwolRun = msUntilNextAwolScanRun();
  console.log(
    `[employee-lifecycle] AWOL detection scan scheduled in ${Math.round(msUntilAwolRun / 60000)}m ` +
    `(next 2:00 AM)`
  );
  _awolTimer = setTimeout(runAwolScan, msUntilAwolRun);

  // Daily last-working-day scan at 3:00 AM
  const msUntilLwdRun = msUntilNextLwdScanRun();
  console.log(
    `[employee-lifecycle] Last-working-day scan scheduled in ${Math.round(msUntilLwdRun / 60000)}m ` +
    `(next 3:00 AM)`
  );
  _lwdTimer = setTimeout(runLwdScan, msUntilLwdRun);

  // Daily NOC LWD trigger at 8:00 AM
  const msUntilNocRun = msUntilNextNocTriggerRun();
  console.log(
    `[employee-lifecycle] NOC LWD trigger scheduled in ${Math.round(msUntilNocRun / 60000)}m ` +
    `(next 8:00 AM)`
  );
  _nocTriggerTimer = setTimeout(runNocTrigger, msUntilNocRun);

  // Daily exit-clearance LWD trigger at 8:30 AM
  const msUntilClearanceLwdRun = msUntilNextClearanceLwdTriggerRun();
  console.log(
    `[employee-lifecycle] Exit-clearance LWD trigger scheduled in ${Math.round(msUntilClearanceLwdRun / 60000)}m ` +
    `(next 8:30 AM)`
  );
  _clearanceLwdTriggerTimer = setTimeout(runClearanceLwdTrigger, msUntilClearanceLwdRun);
}

export function stopEmployeeLifecycleWorker(): void {
  if (_activationTimer) { clearTimeout(_activationTimer); _activationTimer = null; }
  if (_retryTimer) { clearInterval(_retryTimer); _retryTimer = null; }
  if (_awolTimer) { clearTimeout(_awolTimer); _awolTimer = null; }
  if (_lwdTimer) { clearTimeout(_lwdTimer); _lwdTimer = null; }
  if (_nocTriggerTimer) { clearTimeout(_nocTriggerTimer); _nocTriggerTimer = null; }
  if (_clearanceLwdTriggerTimer) { clearTimeout(_clearanceLwdTriggerTimer); _clearanceLwdTriggerTimer = null; }
}
