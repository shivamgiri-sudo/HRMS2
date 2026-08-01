import { describe, it, expect } from "vitest";
import { decideCosecLock } from "../src/modules/wfm/cosec-sync.service.js";

/**
 * cosec_biometric recorded 5,593 failed runs against valid credentials, every
 * one of them refused with "COSEC sync is already running".
 *
 * The `finally` that clears the flag was always correct, so a thrown error was
 * never the cause. A hang was: the COSEC SQL Server spends ~15s in its
 * post-login phase and can stall there, and a sync that never returns never
 * reaches `finally`. The flag then stayed set for the life of the process and
 * every later run was refused.
 *
 * These pin the takeover rule. The decision is pure so it can be tested without
 * a COSEC server, a database, or an hour of waiting.
 */

const HOUR = 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

describe("COSEC sync lock", () => {
  it("acquires freely when idle", () => {
    expect(decideCosecLock(null, NOW, HOUR)).toEqual({ action: "acquire" });
  });

  it("refuses while a genuine run is in flight", () => {
    const decision = decideCosecLock(NOW - 90_000, NOW, HOUR);
    expect(decision.action).toBe("reject");
    expect(decision).toMatchObject({ heldMs: 90_000 });
  });

  it("takes over a lock held past the stale threshold", () => {
    // The exact failure mode: a holder that will never return.
    const decision = decideCosecLock(NOW - 36 * 24 * HOUR, NOW, HOUR);
    expect(decision.action).toBe("takeover");
  });

  it("does not take over one millisecond early", () => {
    // Boundary matters: taking over too eagerly risks two concurrent syncs
    // both pulling the same expensive source window.
    expect(decideCosecLock(NOW - (HOUR - 1), NOW, HOUR).action).toBe("reject");
    expect(decideCosecLock(NOW - HOUR, NOW, HOUR).action).toBe("takeover");
  });

  it("reports how long the lock was held, so the hang is visible", () => {
    // Without this the takeover is silent and the underlying hang stays hidden.
    const decision = decideCosecLock(NOW - 5 * HOUR, NOW, HOUR);
    expect(decision).toMatchObject({ action: "takeover", heldMs: 5 * HOUR });
  });

  it("never deadlocks permanently for any holder age", () => {
    // The property that actually matters: no elapsed time leaves the sync
    // refusing forever, which is what produced 5,593 failures.
    for (const ageHours of [2, 24, 24 * 7, 24 * 36]) {
      expect(decideCosecLock(NOW - ageHours * HOUR, NOW, HOUR).action).toBe("takeover");
    }
  });
});
