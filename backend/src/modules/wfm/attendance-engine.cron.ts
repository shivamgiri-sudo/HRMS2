import { attendanceEngineService } from './attendance-engine.service.js';

const RUN_HOUR = 23;
let nextRun: NodeJS.Timeout | undefined;

export async function runAttendanceSweep(): Promise<{ processed: number; skipped: number; failed: number }> {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const date = yesterday.toISOString().split('T')[0]!;

  console.log(`[AttendanceEngine] Starting sweep for ${date}`);
  const result = await attendanceEngineService.processDateBatch(date, 50);
  console.log(
    `[AttendanceEngine] Completed ${date}: processed=${result.processed} ` +
    `skipped=${result.skipped} failed=${result.failed}`
  );
  if (result.errors.length > 0) {
    result.errors.forEach(e => console.error(`[AttendanceEngine] Error: ${e}`));
  }
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
