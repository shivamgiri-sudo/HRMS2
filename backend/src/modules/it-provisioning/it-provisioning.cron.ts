import { autoLockConfirmedRequests } from './it-provisioning.service.js';

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
  }, 60 * 60 * 1000);

  console.log('[it-provisioning] auto-lock scheduler started (hourly)');
}
