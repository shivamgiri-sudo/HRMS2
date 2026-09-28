/**
 * Daily sweep for employee_code drift between ats_candidate/ats_onboarding_bridge and the real
 * employees row — see employee-code-reconciliation.service.ts for why this exists and what the
 * two checks it runs actually catch. Off-peak hour, same setTimeout-reschedule pattern as
 * tenure.cron.ts and the other schedulers started from server.ts.
 */
import { reconcileEmployeeCodeDrift } from './employee-code-reconciliation.service.js';

const RUN_HOUR = 3;
let nextRun: NodeJS.Timeout | undefined;

export function millisecondsUntilNextReconciliation(now = new Date()): number {
  const next = new Date(now);
  next.setHours(RUN_HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

export function startEmployeeCodeReconciliationScheduler(): void {
  if (nextRun) return;
  nextRun = setTimeout(async () => {
    try {
      const result = await reconcileEmployeeCodeDrift();
      if (result.staleCodesRepaired.length || result.orphansFlagged.length) {
        console.info(
          `[employee-code-reconciliation] repaired ${result.staleCodesRepaired.length} stale code(s), flagged ${result.orphansFlagged.length} orphan(s)`,
        );
      }
    } catch (error) {
      console.error('[employee-code-reconciliation] sweep failed', error);
    } finally {
      nextRun = undefined;
      startEmployeeCodeReconciliationScheduler();
    }
  }, millisecondsUntilNextReconciliation());
  nextRun.unref();
}

export function stopEmployeeCodeReconciliationScheduler(): void {
  if (nextRun) {
    clearTimeout(nextRun);
    nextRun = undefined;
  }
}
