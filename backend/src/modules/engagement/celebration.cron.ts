import { runCelebrationSweep } from "./celebration-post.service.js";

const RUN_HOUR = 8; // 8 AM IST daily
let nextRun: NodeJS.Timeout | undefined;

export function millisecondsUntilNextCelebrationSweep(now = new Date()): number {
  const next = new Date(now);
  next.setHours(RUN_HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

export function startCelebrationScheduler(): void {
  if (nextRun) return;
  nextRun = setTimeout(async () => {
    try {
      const result = await runCelebrationSweep();
      console.log(
        `[celebration] Sweep done — birthdays: ${result.birthdays}, anniversaries: ${result.anniversaries}, failed: ${result.failed}`,
      );
    } catch (err) {
      console.error("[celebration] Sweep error:", err);
    } finally {
      nextRun = undefined;
      startCelebrationScheduler();
    }
  }, millisecondsUntilNextCelebrationSweep());
  nextRun.unref();
}

export function stopCelebrationScheduler(): void {
  if (!nextRun) return;
  clearTimeout(nextRun);
  nextRun = undefined;
}
