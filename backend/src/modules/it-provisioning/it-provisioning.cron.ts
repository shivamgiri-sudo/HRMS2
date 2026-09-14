import { autoLockConfirmedRequests, notifyOverdueProvisioning } from './it-provisioning.service.js';

let _timer: ReturnType<typeof setInterval> | null = null;

export function startITProvisioningLockScheduler(): void {
  if (_timer) return;
  // Run once an hour
  _timer = setInterval(async () => {
    try {
      const result = await autoLockConfirmedRequests();
      if (result.locked > 0) {
        console.log(`[it-provisioning] auto-locked ${result.locked} actioned request(s)`);
      }
    } catch (err) {
      console.error('[it-provisioning] auto-lock cron error:', err);
    }

    // Push the SLA breach that sla_due_at has only ever described on a page someone
    // had to open. Separate try/catch on purpose: auto-locking evidence and telling
    // someone a task is late are independent duties, and a failure in the newer one
    // must not stop the older one that has been running unattended for months.
    try {
      const overdue = await notifyOverdueProvisioning();
      if (overdue.notified > 0) {
        console.log(`[it-provisioning] notified ${overdue.notified} overdue request(s)`);
      }
    } catch (err) {
      console.error('[it-provisioning] overdue-notification cron error:', err);
    }
  }, 60 * 60 * 1000);

  console.log('[it-provisioning] auto-lock scheduler started (hourly)');
}

export function stopITProvisioningLockScheduler(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  console.log('[it-provisioning] Stopped');
}
