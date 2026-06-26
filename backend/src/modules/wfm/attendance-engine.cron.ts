import { attendanceEngineService } from './attendance-engine.service.js';

// Run every 5 minutes to keep attendance data fresh
const SYNC_INTERVAL_MS = 5 * 60 * 1000;
let nextRun: NodeJS.Timeout | undefined;

export async function runAttendanceSweep(): Promise<{ processed: number; skipped: number; failed: number }> {
  // Process yesterday's data for today's attendance record
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

export function millisecondsUntilNextAttendanceSweep(): number {
  // Run every 5 minutes, starting from the next 5-minute interval
  return SYNC_INTERVAL_MS;
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
