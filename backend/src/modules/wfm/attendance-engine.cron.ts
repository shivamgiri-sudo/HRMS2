import { attendanceEngineService } from './attendance-engine.service.js';
import { nowIST } from '../../shared/timezone.js';
import { recordWorkerRun } from '../../workers/worker-utils.js';
import { runHealOnce } from './attendance-heal.worker.js';

export const SWEEP_WORKER_NAME = 'attendance-engine-sweep';

const RUN_HOUR = 23;
let nextRun: NodeJS.Timeout | undefined;

export async function runAttendanceSweep(): Promise<{ processed: number; skipped: number; failed: number }> {
  // Use IST date so the cron always processes the correct calendar day even
  // when the server clock is UTC (between 00:00 and 05:30 IST, toISOString
  // would return the previous UTC date, causing the wrong day to be processed).
  const todayIST = nowIST().split('T')[0]!;
  const [y, m, d] = todayIST.split('-').map(Number) as [number, number, number];
  const yesterdayDate = new Date(y, m - 1, d - 1);
  const date = `${yesterdayDate.getFullYear()}-${String(yesterdayDate.getMonth() + 1).padStart(2, '0')}-${String(yesterdayDate.getDate()).padStart(2, '0')}`;

  console.log(`[AttendanceEngine] Starting sweep for ${date}`);
  await recordWorkerRun(SWEEP_WORKER_NAME, 'started', { date });
  const result = await attendanceEngineService.processDateBatch(date, 50);
  await recordWorkerRun(SWEEP_WORKER_NAME, result.failed > 0 ? 'failed' : 'completed', { date, processed: result.processed, skipped: result.skipped, failed: result.failed });
  console.log(
    `[AttendanceEngine] Completed ${date}: processed=${result.processed} ` +
    `skipped=${result.skipped} failed=${result.failed}`
  );
  if (result.errors.length > 0) {
    result.errors.forEach(e => console.error(`[AttendanceEngine] Error: ${e}`));
  }
  // Whatever this run missed (or a restart cut short) is filled straight away instead of staying a hole.
  await runHealOnce().catch(() => undefined);
  return result;
}

export function millisecondsUntilNextAttendanceSweep(now = new Date()): number {
  const next = new Date(now);
  next.setHours(RUN_HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

export function startAttendanceEngineScheduler(): void {
  if (nextRun) return;
  nextRun = setTimeout(async () => {
    try {
      await runAttendanceSweep();
    } catch (error) {
      console.error('[AttendanceEngine] Sweep failed', error);
    } finally {
      nextRun = undefined;
      startAttendanceEngineScheduler();
    }
  }, millisecondsUntilNextAttendanceSweep());
  nextRun.unref();
}

export function stopAttendanceEngineScheduler(): void {
  if (!nextRun) return;
  clearTimeout(nextRun);
  nextRun = undefined;
}
