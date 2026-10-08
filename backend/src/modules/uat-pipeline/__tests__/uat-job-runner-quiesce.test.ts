/**
 * The runner must not flood the log when its table does not exist — and must still recover.
 *
 * WHY THIS MATTERS IN PRODUCTION
 *   Migrations run in server.ts. all-workers.ts — where this runner lives — does NOT run
 *   them, and the two are separate pm2 services. Every deploy therefore has a window where
 *   the worker polls a table the API has not created yet, and a failed migration makes that
 *   window permanent. At a 15s poll that is 5,760 error lines a day into the log every other
 *   worker shares, which buries their diagnostics.
 *
 *   The fix must not overcorrect into silence: a runner that goes quiet and never retries
 *   would stay dead after the migration landed, needing a restart nobody knows to perform.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../../db/mysql.js";
import { resetRunnerState, startUatJobRunner, stopUatJobRunner } from "../uat-job-runner.js";

const mockQuery = db.query as unknown as ReturnType<typeof vi.fn>;

/** The error mysql2 raises for a missing table. */
function missingTable(): Error & { code: string } {
  return Object.assign(new Error("Table 'mas_hrms.uat_job' doesn't exist"), {
    code: "ER_NO_SUCH_TABLE",
  });
}

const POLL_MS = 15_000;

beforeEach(() => {
  vi.useFakeTimers();
  mockQuery.mockReset();
  resetRunnerState();
});

afterEach(() => {
  stopUatJobRunner();
  resetRunnerState();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("when uat_job does not exist", () => {
  it("logs once, not once per poll", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    mockQuery.mockRejectedValue(missingTable());

    startUatJobRunner();
    // Twelve polls — three minutes of production time.
    for (let i = 0; i < 12; i++) {
      await vi.advanceTimersByTimeAsync(POLL_MS);
    }

    const complaints = err.mock.calls.filter((c) => String(c[0]).includes("uat_job is missing"));
    expect(complaints).toHaveLength(1);
  });

  it("names the migration, so the log says what to do about it", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    mockQuery.mockRejectedValue(missingTable());

    startUatJobRunner();
    await vi.advanceTimersByTimeAsync(POLL_MS);

    expect(String(err.mock.calls[0]?.[0])).toContain("1103");
  });

  it("stops querying between retries rather than hammering the database", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockQuery.mockRejectedValue(missingTable());

    startUatJobRunner();
    await vi.advanceTimersByTimeAsync(POLL_MS);
    const afterFirst = mockQuery.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);

    // Several more polls inside the quiet window issue no further queries.
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(mockQuery.mock.calls.length).toBe(afterFirst);
  });
});

describe("recovery", () => {
  it("resumes automatically once the migration lands — no restart", async () => {
    // The half that matters. Going quiet is only acceptable because it comes back.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    mockQuery.mockRejectedValue(missingTable());

    startUatJobRunner();
    await vi.advanceTimersByTimeAsync(POLL_MS);

    // Migration applies: claim finds no work, which is the healthy idle answer.
    mockQuery.mockReset();
    mockQuery.mockResolvedValue([{ affectedRows: 0 }, []]);

    // Advance past the quiet window.
    for (let i = 0; i < 21; i++) await vi.advanceTimersByTimeAsync(POLL_MS);

    expect(mockQuery.mock.calls.length).toBeGreaterThan(0);
    expect(log.mock.calls.some((c) => String(c[0]).includes("present again"))).toBe(true);
  });
});

describe("every other failure still reports normally", () => {
  it("does not silence an unrelated database error", async () => {
    // Quiescing is scoped to a missing table. A connection failure or a syntax error is a
    // real fault and must keep surfacing on every poll.
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    mockQuery.mockRejectedValue(
      Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" }),
    );

    startUatJobRunner();
    for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(POLL_MS);

    const ticks = err.mock.calls.filter((c) => String(c[0]).includes("runner tick failed"));
    expect(ticks.length).toBeGreaterThan(1);
    expect(err.mock.calls.some((c) => String(c[0]).includes("uat_job is missing"))).toBe(false);
  });
});
