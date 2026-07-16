/**
 * Employee Lifecycle Worker
 *
 * Runs two scheduled jobs:
 * 1. Daily activation at 12:01 AM - activates employees whose joining date has arrived
 * 2. Hourly provisioning retry - retries failed provisioning task dispatch
 */

import { runDailyActivationJob } from '../modules/employees/employee-activation.service.js';
import { runProvisioningRetryJob } from '../jobs/provisioning-retry.job.js';

let _activationTimer: ReturnType<typeof setTimeout> | null = null;
let _retryTimer: ReturnType<typeof setInterval> | null = null;

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
  if (_activationTimer || _retryTimer) return;

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
}

export function stopEmployeeLifecycleWorker(): void {
  if (_activationTimer) { clearTimeout(_activationTimer); _activationTimer = null; }
  if (_retryTimer) { clearInterval(_retryTimer); _retryTimer = null; }
}
