import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backoffDelay, createPoller } from "../poller";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("backoffDelay", () => {
  it("is the interval when healthy, doubles per failure, and is capped", () => {
    expect(backoffDelay(1000, 0)).toBe(1000); expect(backoffDelay(1000, 1)).toBe(2000); expect(backoffDelay(1000, 3)).toBe(8000);
    expect(backoffDelay(1000, 20, 60_000)).toBe(60_000);
  });
});

describe("createPoller", () => {
  it("ticks on the interval", async () => {
    const tick = vi.fn().mockResolvedValue(undefined);
    const p = createPoller({ tick, intervalMs: 1000 }); p.start();
    await vi.advanceTimersByTimeAsync(3100);
    expect(tick).toHaveBeenCalledTimes(3); p.stop();
  });
  it("backs off exponentially after failures and recovers on success", async () => {
    let fail = true;
    const tick = vi.fn(async () => { if (fail) throw new Error("boom"); });
    const p = createPoller({ tick, intervalMs: 1000 }); p.start();
    await vi.advanceTimersByTimeAsync(1000); expect(tick).toHaveBeenCalledTimes(1); expect(p.state().failures).toBe(1);
    await vi.advanceTimersByTimeAsync(1999); expect(tick).toHaveBeenCalledTimes(1); // next is at +2000
    await vi.advanceTimersByTimeAsync(1); expect(tick).toHaveBeenCalledTimes(2); expect(p.state().failures).toBe(2);
    fail = false;
    await vi.advanceTimersByTimeAsync(4000); expect(tick).toHaveBeenCalledTimes(3); expect(p.state().failures).toBe(0);
    await vi.advanceTimersByTimeAsync(1000); expect(tick).toHaveBeenCalledTimes(4); p.stop();
  });
  it("stops polling while the tab is hidden and refreshes immediately when it returns", async () => {
    const tick = vi.fn().mockResolvedValue(undefined);
    const p = createPoller({ tick, intervalMs: 1000 }); p.start();
    p.setHidden(true);
    await vi.advanceTimersByTimeAsync(5000); expect(tick).not.toHaveBeenCalled();
    p.setHidden(false); await vi.advanceTimersByTimeAsync(0); expect(tick).toHaveBeenCalledTimes(1); p.stop();
  });
  it("pause/resume", async () => {
    const tick = vi.fn().mockResolvedValue(undefined);
    const p = createPoller({ tick, intervalMs: 1000 }); p.start(); p.pause();
    await vi.advanceTimersByTimeAsync(3000); expect(tick).not.toHaveBeenCalled();
    p.resume(); await vi.advanceTimersByTimeAsync(0); expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000); expect(tick).toHaveBeenCalledTimes(2); p.stop();
  });
  it("refreshNow works while paused and leaves it paused", async () => {
    const tick = vi.fn().mockResolvedValue(undefined);
    const p = createPoller({ tick, intervalMs: 1000 }); p.start(); p.pause();
    await p.refreshNow(); expect(tick).toHaveBeenCalledTimes(1); expect(p.state().paused).toBe(true);
    await vi.advanceTimersByTimeAsync(3000); expect(tick).toHaveBeenCalledTimes(1); p.stop();
  });
  it("never overlaps ticks", async () => {
    let running = 0, max = 0;
    const tick = vi.fn(async () => { running++; max = Math.max(max, running); await new Promise((r) => setTimeout(r, 2500)); running--; });
    const p = createPoller({ tick, intervalMs: 1000 }); p.start();
    await vi.advanceTimersByTimeAsync(10_000); expect(max).toBe(1); p.stop();
  });
});
