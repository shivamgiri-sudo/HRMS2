import { beforeEach, describe, expect, it, vi } from "vitest";
import { cachedSummary, clearSummaryCache, SUMMARY_STALE_MS, SUMMARY_TTL_MS } from "../ops-summary-cache.js";

const flush = () => new Promise((r) => setImmediate(r));
// Only Date is faked: setImmediate stays real so the background refresh can be flushed.
beforeEach(() => {
  clearSummaryCache();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-03T00:00:00Z"));
});
const advance = (ms: number) => vi.setSystemTime(Date.now() + ms);

describe("cachedSummary", () => {
  it("computes once and serves the same value while fresh", async () => {
    const load = vi.fn(async () => ({ n: 1 }));
    expect(await cachedSummary("d", load)).toEqual({ n: 1 });
    advance(SUMMARY_TTL_MS - 1);
    expect(await cachedSummary("d", load)).toEqual({ n: 1 });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("concurrent callers share one computation", async () => {
    let release!: (v: { n: number }) => void;
    const load = vi.fn(() => new Promise<{ n: number }>((r) => { release = r; }));
    const a = cachedSummary("d", load);
    const b = cachedSummary("d", load);
    release({ n: 7 });
    expect(await a).toEqual({ n: 7 });
    expect(await b).toEqual({ n: 7 });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("stale value is served immediately and refreshed once in the background", async () => {
    let v = 1;
    const load = vi.fn(async () => ({ n: v }));
    await cachedSummary("d", load);
    v = 2;
    advance(SUMMARY_TTL_MS + 1000);
    expect(await cachedSummary("d", load)).toEqual({ n: 1 }); // old value, instantly
    await cachedSummary("d", load);                            // must not start a second refresh
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
    expect(await cachedSummary("d", load)).toEqual({ n: 2 });
  });

  it("a value older than the stale window is recomputed, not served", async () => {
    let v = 1;
    const load = vi.fn(async () => ({ n: v }));
    await cachedSummary("d", load);
    v = 3;
    advance(SUMMARY_STALE_MS + 1);
    expect(await cachedSummary("d", load)).toEqual({ n: 3 });
  });

  it("failures are not cached and the next call retries", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("db")).mockResolvedValue({ n: 5 });
    await expect(cachedSummary("d", load)).rejects.toThrow("db");
    expect(await cachedSummary("d", load)).toEqual({ n: 5 });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("a failed background refresh keeps serving the stale value", async () => {
    const load = vi.fn().mockResolvedValueOnce({ n: 1 }).mockRejectedValue(new Error("db"));
    await cachedSummary("d", load);
    advance(SUMMARY_TTL_MS + 1);
    expect(await cachedSummary("d", load)).toEqual({ n: 1 });
    await flush();
    advance(1);
    expect(await cachedSummary("d", load)).toEqual({ n: 1 });
  });

  it("keys are independent (different dates)", async () => {
    const load = vi.fn(async () => ({ n: Math.random() }));
    const a = await cachedSummary("2026-10-02", load);
    const b = await cachedSummary("2026-10-03", load);
    expect(a).not.toEqual(b);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
