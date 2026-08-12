import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The sweep used to reschedule for the next day on any failure, so one transient error
 * cost a whole day of birthday and anniversary greetings — silently, because nobody
 * notices mail that was never sent.
 *
 * Production evidence (2026-08-12): the sweep failed at exactly 08:00:00 on 4, 5, 6, 7,
 * 8, 9, 11 and 12 August — every day the log covers — always with
 * "Database circuit breaker open. Retry after 40s". "[celebration] Sweep done" appears
 * zero times. Eight days of greetings lost to an error that asked to be retried in 40
 * seconds while the scheduler waited 24 hours.
 */
const runCelebrationSweep = vi.fn();
vi.mock("../celebration-post.service.js", () => ({
  runCelebrationSweep: () => runCelebrationSweep(),
}));

const OK = { birthdays: 2, anniversaries: 1, failed: 0 };

let cron: typeof import("../celebration.cron.js");

beforeEach(async () => {
  vi.useFakeTimers();
  runCelebrationSweep.mockReset();
  vi.resetModules();
  cron = await import("../celebration.cron.js");
});

afterEach(() => {
  cron.stopCelebrationScheduler();
  vi.useRealTimers();
});

/** Advance to the first 08:00 firing. */
async function advanceToFirstRun() {
  await vi.advanceTimersByTimeAsync(cron.millisecondsUntilNextCelebrationSweep() + 10);
}

describe("celebration sweep survives a transient failure", () => {
  it("retries instead of skipping the day", async () => {
    runCelebrationSweep
      .mockRejectedValueOnce(new Error("Database circuit breaker open. Retry after 40s"))
      .mockResolvedValueOnce(OK);

    cron.startCelebrationScheduler();
    await advanceToFirstRun();
    expect(runCelebrationSweep).toHaveBeenCalledTimes(1);

    // Previously this was the end of it until tomorrow.
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 10);
    expect(runCelebrationSweep).toHaveBeenCalledTimes(2);
  });

  it("keeps retrying while the breaker stays open, up to the cap", async () => {
    runCelebrationSweep.mockRejectedValue(new Error("Database circuit breaker open"));

    cron.startCelebrationScheduler();
    await advanceToFirstRun();
    for (let i = 0; i < 8; i++) await vi.advanceTimersByTimeAsync(5 * 60_000 + 10);

    // Bounded: it must not hammer a struggling database forever.
    expect(runCelebrationSweep).toHaveBeenCalledTimes(6);
  });

  it("does not retry when the sweep succeeds", async () => {
    runCelebrationSweep.mockResolvedValue(OK);

    cron.startCelebrationScheduler();
    await advanceToFirstRun();
    expect(runCelebrationSweep).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5 * 60_000 + 10);
    expect(runCelebrationSweep).toHaveBeenCalledTimes(1);
  });

  it("still schedules the next day after exhausting retries", async () => {
    runCelebrationSweep.mockRejectedValue(new Error("still down"));

    cron.startCelebrationScheduler();
    await advanceToFirstRun();
    for (let i = 0; i < 8; i++) await vi.advanceTimersByTimeAsync(5 * 60_000 + 10);
    expect(runCelebrationSweep).toHaveBeenCalledTimes(6);

    // A day that fails outright must not disable the scheduler permanently.
    runCelebrationSweep.mockResolvedValue(OK);
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
    expect(runCelebrationSweep.mock.calls.length).toBeGreaterThan(6);
  });
});
