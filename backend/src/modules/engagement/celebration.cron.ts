import { runCelebrationSweep } from "./celebration-post.service.js";

/**
 * Daily birthday / work-anniversary sweep.
 *
 * WHY THIS RETRIES
 *
 * The sweep fired at 08:00 and, on failure, simply rescheduled for the next day. One
 * transient error therefore cost a whole day of greetings, silently — nobody notices an
 * email that was never sent.
 *
 * That is not hypothetical. Measured on production 2026-08-12, the sweep failed at
 * exactly 08:00:00 on 4, 5, 6, 7, 8, 9, 11 and 12 August — every day the log covers —
 * always with the same cause:
 *
 *   [celebration] Sweep error: Error: Database circuit breaker open. Retry after 40s
 *       at queryTodayBirthdays (celebration-post.service.js:60)
 *
 * `[celebration] Sweep done` appears zero times in the entire log. So no birthday or
 * anniversary greeting has gone out for at least eight days, and the failure mode is a
 * breaker that explicitly says it wants to be retried in 40 seconds while the scheduler
 * waits 24 hours instead. 08:00 is when many workers start at once, so the pool is
 * briefly exhausted precisely when this runs.
 *
 * Retrying is safe: both sendBirthdayGreeting and sendAnniversaryGreeting open with
 * hasCelebrationPostToday(), which checks company_posts for
 * `DATE(created_at) = CURDATE()`, so a repeat pass on the same day cannot double-post or
 * double-mail. Partial progress from a failed attempt is kept rather than repeated.
 */
const RUN_HOUR = 8; // 8 AM IST daily
const RETRY_DELAY_MS = 5 * 60_000; // breaker asks for ~40s; 5 min gives the pool room
const MAX_ATTEMPTS = 6; // ~30 minutes of cover, then wait for tomorrow

let nextRun: NodeJS.Timeout | undefined;

export function millisecondsUntilNextCelebrationSweep(now = new Date()): number {
  const next = new Date(now);
  next.setHours(RUN_HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

function schedule(delayMs: number, attempt: number): void {
  nextRun = setTimeout(async () => {
    try {
      const result = await runCelebrationSweep();
      console.log(
        `[celebration] Sweep done — birthdays: ${result.birthdays}, anniversaries: ${result.anniversaries}, failed: ${result.failed}`,
      );
      nextRun = undefined;
      schedule(millisecondsUntilNextCelebrationSweep(), 1);
    } catch (err) {
      nextRun = undefined;
      const message = err instanceof Error ? err.message : String(err);
      if (attempt < MAX_ATTEMPTS) {
        console.error(
          `[celebration] Sweep attempt ${attempt}/${MAX_ATTEMPTS} failed (${message}) — retrying in ${RETRY_DELAY_MS / 60_000}m`,
        );
        schedule(RETRY_DELAY_MS, attempt + 1);
      } else {
        // Loud on the way out: this is a day of greetings nobody will otherwise miss.
        console.error(
          `[celebration] Sweep FAILED after ${MAX_ATTEMPTS} attempts (${message}). ` +
            `No birthday or anniversary greeting was sent today — investigate before tomorrow's run.`,
        );
        schedule(millisecondsUntilNextCelebrationSweep(), 1);
      }
    }
  }, delayMs);
  nextRun.unref();
}

export function startCelebrationScheduler(): void {
  if (nextRun) return;
  schedule(millisecondsUntilNextCelebrationSweep(), 1);
}

export function stopCelebrationScheduler(): void {
  if (!nextRun) return;
  clearTimeout(nextRun);
  nextRun = undefined;
}
