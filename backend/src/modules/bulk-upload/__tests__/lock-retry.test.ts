/**
 * The bug these tests pin down.
 *
 * Every approval-gated bulk service carried its own `withDeadlockRetry`, and all four matched
 * only `ER_LOCK_DEADLOCK` / errno 1213. The live database runs `innodb_lock_wait_timeout = 60`,
 * and the error rows actually failed with is the *other* lock error — errno 1205,
 * `ER_LOCK_WAIT_TIMEOUT`. Live `upload_batch_row` rows recorded it verbatim:
 *
 *     ["Row 13: Lock wait timeout exceeded; try restarting transaction"]
 *     ["Row 1 (MAS63411): Lock wait timeout exceeded; try restarting transaction"]
 *
 * Because 1205 was not recognised, such a row blocked for a full minute and was then written
 * off as a permanent failure. `retries a lock wait timeout` below is the regression guard: it
 * fails against the old helper and passes against `withBulkLockRetry`.
 */
import { describe, expect, it, vi } from "vitest";
import { withBulkLockRetry } from "../lock-retry.js";

/** Shaped like a real mysql2 error, which carries both `code` and `errno`. */
function mysqlError(code: string, errno: number): Error & { code: string; errno: number } {
  return Object.assign(new Error(code), { code, errno });
}

const deadlock = () => mysqlError("ER_LOCK_DEADLOCK", 1213);
const lockWait = () => mysqlError("ER_LOCK_WAIT_TIMEOUT", 1205);

describe("withBulkLockRetry", () => {
  it("retries a lock wait timeout — the error the old helper ignored", async () => {
    const attempt = vi.fn<[], Promise<string>>();
    attempt.mockRejectedValueOnce(lockWait()).mockResolvedValueOnce("applied");

    await expect(withBulkLockRetry(attempt)).resolves.toBe("applied");
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("retries a lock wait timeout recognised by errno alone", async () => {
    // Some driver paths surface the numeric errno without the symbolic code, so matching
    // only on `code` would silently miss exactly the rows this fix is for.
    const attempt = vi.fn<[], Promise<string>>();
    attempt.mockRejectedValueOnce(mysqlError("", 1205)).mockResolvedValueOnce("applied");

    await expect(withBulkLockRetry(attempt)).resolves.toBe("applied");
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("retries a deadlock more than once", async () => {
    // The old budget was 3 attempts. A batch that lost every one of its 107 rows to a
    // deadlock (BATCH-1788270838165) is what says that budget was too small.
    const attempt = vi.fn<[], Promise<string>>();
    attempt
      .mockRejectedValueOnce(deadlock())
      .mockRejectedValueOnce(deadlock())
      .mockRejectedValueOnce(deadlock())
      .mockResolvedValueOnce("applied");

    await expect(withBulkLockRetry(attempt)).resolves.toBe("applied");
    expect(attempt).toHaveBeenCalledTimes(4);
  });

  it("gives up on a deadlock rather than spinning for ever", async () => {
    const attempt = vi.fn<[], Promise<never>>().mockRejectedValue(deadlock());

    await expect(withBulkLockRetry(attempt)).rejects.toMatchObject({ errno: 1213 });
    // Bounded: a genuinely contended row has to surface as a failed row, not hang the batch.
    expect(attempt).toHaveBeenCalledTimes(5);
  });

  it("spends only one retry on a lock wait timeout, because each one costs 60s", async () => {
    const attempt = vi.fn<[], Promise<never>>().mockRejectedValue(lockWait());

    await expect(withBulkLockRetry(attempt)).rejects.toMatchObject({ errno: 1205 });
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("rethrows a non-lock error immediately", async () => {
    // A bad date or a missing employee must be reported as itself, on the first attempt —
    // retrying it four times only delays the row error the uploader needs to see.
    const attempt = vi
      .fn<[], Promise<never>>()
      .mockRejectedValue(new Error("session_date must be a date"));

    await expect(withBulkLockRetry(attempt)).rejects.toThrow("session_date must be a date");
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("counts the two lock errors against separate budgets", async () => {
    // A row can legitimately hit one of each. Sharing a counter would let a single deadlock
    // consume the lock-wait budget and abandon the row early.
    const attempt = vi.fn<[], Promise<string>>();
    attempt
      .mockRejectedValueOnce(deadlock())
      .mockRejectedValueOnce(lockWait())
      .mockRejectedValueOnce(deadlock())
      .mockResolvedValueOnce("applied");

    await expect(withBulkLockRetry(attempt)).resolves.toBe("applied");
    expect(attempt).toHaveBeenCalledTimes(4);
  });

  it("returns without touching the clock when the first attempt succeeds", async () => {
    const attempt = vi.fn<[], Promise<string>>().mockResolvedValue("applied");

    await expect(withBulkLockRetry(attempt)).resolves.toBe("applied");
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});
