import { logger } from "../logger.js";
import { getCurrentDateIST } from "../shared/istDate.js";
import { refreshRunningSalarySnapshot } from "../modules/process-pnl/pnl-running-salary.service.js";
import { shiftPeriod } from "../modules/process-pnl/pnl-seat-billing.service.js";
import { registerTimer, unregisterTimer, withWorkerLock } from "./worker-utils.js";

/**
 * Keeps pnl_running_salary_snapshot current for the open month, so Live P&L has a real payroll
 * figure (and therefore a real OP%) before that month's payroll run is finalized — the same
 * accrual pnl-reconciliation.service.ts's readPayroll() already falls back to when
 * salary_prep_line has no rows yet for the period.
 *
 * FOUND 2026-09-16: that fallback works, but nothing ever populated the snapshot for the current
 * month — refreshRunningSalarySnapshot() only ran from a manual "Refresh" button
 * (POST /pnl/running-salary/refresh) or when an employee was discarded. September sat at 0 rows
 * for two weeks, so every branch showed real revenue and real GRN but payrollCost=0 and margin
 * NA — not broken, just never triggered. Confirmed live: refreshing it once immediately gave
 * NOIDA-2 a real September margin (48.4%, was NA).
 *
 * Runs for the open estimate window — current + previous IST month, the same two months the
 * seat-rate revenue estimate covers — company-wide (no branch filter), so it always catches up a
 * month as soon as it opens and lets a month settle once behind it. Upsert on (period_code,
 * employee_id), so re-running is always safe: it replaces, never accumulates, and one employee's
 * bad salary config costs only that row, never the run.
 */

const WORKER_NAME = "pnl-running-salary-refresh";
/** Every 4 hours: attendance and incentive data feeding the accrual changes through the day. */
const INTERVAL_MS = 4 * 60 * 60 * 1000;

let intervalTimer: NodeJS.Timeout | null = null;
let startupTimer: NodeJS.Timeout | null = null;

/** The two months refreshed each cycle: the open month and the one just behind it. */
export function windowPeriods(asOf: string): [previous: string, current: string] {
  const current = asOf.slice(0, 7);
  return [shiftPeriod(current, -1), current];
}

async function refreshOne(period: string): Promise<void> {
  try {
    const result = await refreshRunningSalarySnapshot(period);
    logger.info(
      { worker: WORKER_NAME, period, ...result },
      `[running-salary-refresh] ${period}: ${result.snapshotted} snapshotted, ${result.skipped} skipped, ${result.failed} failed`,
    );
  } catch (error) {
    // Never throws onward: a failed refresh must not take the worker down, and the next run
    // (in 4 hours, or the next boot) tries again against whatever changed since.
    logger.error({ worker: WORKER_NAME, period, err: error }, "[running-salary-refresh] FAILED");
  }
}

async function cycle(): Promise<void> {
  await withWorkerLock(WORKER_NAME, async () => {
    const [previous, current] = windowPeriods(getCurrentDateIST());
    await refreshOne(previous);
    await refreshOne(current);
  });
}

export function startPnlRunningSalaryRefreshWorker(): void {
  if (process.env.PNL_RUNNING_SALARY_REFRESH_ENABLED === "false") {
    logger.info({ worker: WORKER_NAME }, "[running-salary-refresh] disabled (PNL_RUNNING_SALARY_REFRESH_ENABLED=false)");
    return;
  }

  // 15 minutes in — after the db_bill syncs, once things have settled from a fresh boot.
  startupTimer = setTimeout(() => {
    void cycle();
  }, 15 * 60 * 1000);
  registerTimer(`${WORKER_NAME}:startup`, startupTimer);

  intervalTimer = setInterval(() => { void cycle(); }, INTERVAL_MS);
  registerTimer(WORKER_NAME, intervalTimer);
  logger.info({ worker: WORKER_NAME, intervalMs: INTERVAL_MS }, "[running-salary-refresh] scheduled");
}

export function stopPnlRunningSalaryRefreshWorker(): void {
  if (startupTimer) { clearTimeout(startupTimer); unregisterTimer(`${WORKER_NAME}:startup`); startupTimer = null; }
  if (intervalTimer) { clearInterval(intervalTimer); unregisterTimer(WORKER_NAME); intervalTimer = null; }
}
