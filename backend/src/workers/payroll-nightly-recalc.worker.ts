import type { RowDataPacket } from 'mysql2';
import { db } from '../db/mysql.js';
import { calculatePayrollRun } from '../modules/payroll/payrollCalculate.service.js';
import { writeAuditLog } from '../shared/auditLog.js';
import { withWorkerLock, registerTimer, unregisterTimer } from './worker-utils.js';

const WORKER_NAME = 'payroll-nightly-recalc';
const SYSTEM_ACTOR_ID = 'system-auto-recalc';

// Track timers for graceful shutdown
let scheduledTimer: NodeJS.Timeout | null = null;
let intervalTimer: NodeJS.Timeout | null = null;

function currentRunMonth(): string {
  // Use IST date (UTC+5:30)
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

async function runNightlyRecalcInternal(): Promise<void> {
  const runMonth = currentRunMonth();
  console.log(`[${WORKER_NAME}] Starting nightly recalc for ${runMonth}...`);

  const [runs] = await db.execute<RowDataPacket[]>(
    `SELECT id, run_month, status FROM salary_prep_run
      WHERE run_month = ? AND status IN ('draft', 'processing')
      ORDER BY created_at ASC`,
    [runMonth]
  );

  if (!runs.length) {
    console.log(`[${WORKER_NAME}] No open runs for ${runMonth} — nothing to do.`);
    return;
  }

  for (const run of runs as Array<{ id: string; run_month: string; status: string }>) {
    try {
      console.log(`[${WORKER_NAME}] Recalculating run ${run.id} (${run.run_month}, ${run.status})...`);
      const result = await calculatePayrollRun(run.id, SYSTEM_ACTOR_ID);
      console.log(`[${WORKER_NAME}] Run ${run.id} done — employees: ${result.employees_processed}, gross: ${result.total_gross}, net: ${result.total_net}`);
      await writeAuditLog({
        actor_user_id: SYSTEM_ACTOR_ID,
        action_type: 'PAYROLL_AUTO_RECALC',
        module_key: 'payroll',
        entity_type: 'salary_prep_run',
        entity_id: run.id,
        metadata: {
          run_month: run.run_month,
          employees_processed: result.employees_processed,
          total_gross: result.total_gross,
          total_net: result.total_net,
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[${WORKER_NAME}] Failed for run ${run.id}:`, message);
    }
  }

  console.log(`[${WORKER_NAME}] Nightly recalc complete.`);
}

/**
 * Run nightly recalc with distributed lock protection.
 * Only one instance will execute at a time.
 */
async function runNightlyRecalc(): Promise<void> {
  const executed = await withWorkerLock(WORKER_NAME, runNightlyRecalcInternal);
  if (!executed) {
    console.log(`[${WORKER_NAME}] Skipped - another instance is running`);
  }
}

export async function startPayrollNightlyRecalcWorker(): Promise<void> {
  // Schedule: run once at startup for current month, then nightly at 23:45 IST (18:15 UTC).
  // We calculate ms until next 18:15 UTC, then repeat every 24h.
  const scheduleNext = () => {
    const now = new Date();
    const target = new Date(now);
    target.setUTCHours(18, 15, 0, 0);
    if (target <= now) {
      target.setUTCDate(target.getUTCDate() + 1);
    }
    const delay = target.getTime() - now.getTime();
    console.log(`[${WORKER_NAME}] Next run scheduled at ${target.toISOString()} (in ${Math.round(delay / 60000)} min)`);

    scheduledTimer = setTimeout(async () => {
      await runNightlyRecalc().catch(err => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[${WORKER_NAME}] Error:`, message);
      });

      intervalTimer = setInterval(
        () => runNightlyRecalc().catch(err => {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[${WORKER_NAME}] Error:`, message);
        }),
        24 * 60 * 60 * 1000
      );
      registerTimer(`${WORKER_NAME}-interval`, intervalTimer);
    }, delay);
    registerTimer(`${WORKER_NAME}-scheduled`, scheduledTimer);
  };

  scheduleNext();
}

/**
 * Stop the payroll nightly recalc worker (for graceful shutdown).
 */
export function stopPayrollNightlyRecalcWorker(): void {
  if (scheduledTimer) {
    clearTimeout(scheduledTimer);
    unregisterTimer(`${WORKER_NAME}-scheduled`);
    scheduledTimer = null;
  }
  if (intervalTimer) {
    clearInterval(intervalTimer);
    unregisterTimer(`${WORKER_NAME}-interval`);
    intervalTimer = null;
  }
  console.log(`[${WORKER_NAME}] stopped`);
}
