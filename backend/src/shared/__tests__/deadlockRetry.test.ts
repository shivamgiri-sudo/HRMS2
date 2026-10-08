import { describe, expect, it, vi } from "vitest";
import { isDeadlockError, withDeadlockRetry } from "../deadlockRetry.js";

const deadlock = () => Object.assign(new Error("Deadlock found when trying to get lock"), {
  code: "ER_LOCK_DEADLOCK", errno: 1213,
});
const lockWait = () => Object.assign(new Error("Lock wait timeout exceeded"), {
  code: "ER_LOCK_WAIT_TIMEOUT", errno: 1205,
});
const badField = () => Object.assign(new Error("Unknown column 'nope'"), {
  code: "ER_BAD_FIELD_ERROR", errno: 1054,
});

describe("isDeadlockError", () => {
  it("recognises deadlock and lock-wait-timeout, by code or errno", () => {
    expect(isDeadlockError(deadlock())).toBe(true);
    expect(isDeadlockError(lockWait())).toBe(true);
    expect(isDeadlockError({ errno: 1213 })).toBe(true);
    expect(isDeadlockError({ errno: 1205 })).toBe(true);
  });

  it("does not treat a schema error as retryable", () => {
    // Retrying ER_BAD_FIELD_ERROR forever is how a bug becomes an outage.
    expect(isDeadlockError(badField())).toBe(false);
    expect(isDeadlockError(new Error("plain"))).toBe(false);
    expect(isDeadlockError(null)).toBe(false);
    expect(isDeadlockError(undefined)).toBe(false);
  });
});

describe("withDeadlockRetry", () => {
  it("returns the value when the operation succeeds first time", async () => {
    const op = vi.fn().mockResolvedValue("ok");
    await expect(withDeadlockRetry(op, { delayMs: 0 })).resolves.toBe("ok");
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("retries a deadlock and succeeds", async () => {
    const op = vi.fn()
      .mockRejectedValueOnce(deadlock())
      .mockRejectedValueOnce(deadlock())
      .mockResolvedValue("ok");
    await expect(withDeadlockRetry(op, { delayMs: 0 })).resolves.toBe("ok");
    expect(op).toHaveBeenCalledTimes(3);
  });

  it("gives up after the attempt limit and rethrows the last deadlock", async () => {
    // Bounded on purpose. An unbounded retry against a genuinely contended row spins for
    // ever and looks like a hang rather than a failure.
    const op = vi.fn().mockRejectedValue(deadlock());
    await expect(withDeadlockRetry(op, { attempts: 3, delayMs: 0 })).rejects.toThrow(/Deadlock/);
    expect(op).toHaveBeenCalledTimes(3);
  });

  it("rethrows a non-deadlock error immediately, without retrying", async () => {
    const op = vi.fn().mockRejectedValue(badField());
    await expect(withDeadlockRetry(op, { attempts: 5, delayMs: 0 })).rejects.toThrow(/Unknown column/);
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("reports each retry so a run cannot silently absorb contention", async () => {
    const onRetry = vi.fn();
    const op = vi.fn().mockRejectedValueOnce(lockWait()).mockResolvedValue(1);
    await withDeadlockRetry(op, { delayMs: 0, onRetry });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0][0]).toBe(1);
  });

  it("backs off progressively rather than hammering the lock holder", async () => {
    const waits: number[] = [];
    const op = vi.fn()
      .mockRejectedValueOnce(deadlock())
      .mockRejectedValueOnce(deadlock())
      .mockResolvedValue("ok");
    await withDeadlockRetry(op, { delayMs: 10, sleep: async (ms: number) => { waits.push(ms); } });
    expect(waits).toEqual([10, 20]);
  });
});
