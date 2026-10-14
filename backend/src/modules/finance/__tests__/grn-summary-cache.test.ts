import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetGrnSummaryCacheForTests,
  bustGrnSummaryCache,
  cachedGrnSummary,
  summaryCacheKey,
} from "../grn-summary-cache.js";

describe("grn summary cache", () => {
  beforeEach(() => {
    _resetGrnSummaryCacheForTests();
    vi.useFakeTimers();
  });

  it("serves a fresh entry from memory and shares one computation between concurrent callers", async () => {
    const load = vi.fn(async () => ({ n: 1 }));
    const k = summaryCacheKey({ mode: "all" });
    const [a, b] = await Promise.all([cachedGrnSummary(k, load), cachedGrnSummary(k, load)]);
    expect(a).toEqual({ n: 1 });
    expect(b).toEqual({ n: 1 });
    await cachedGrnSummary(k, load);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("keys on scope: another branch set never sees this one's numbers", async () => {
    const a = summaryCacheKey({ mode: "branches", branchIds: ["b2", "b1"] });
    const b = summaryCacheKey({ mode: "branches", branchIds: ["b1", "b2"] });
    const c = summaryCacheKey({ mode: "branches", branchIds: ["b1"] });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(summaryCacheKey({ mode: "all" })).not.toBe(summaryCacheKey({ mode: "all", financialYear: "2026-27" }));
  });

  it("after a write the stale value is answered at once and refreshed behind the response", async () => {
    let n = 0;
    const load = vi.fn(async () => ({ n: ++n }));
    const k = summaryCacheKey({ mode: "all" });
    expect(await cachedGrnSummary(k, load)).toEqual({ n: 1 });
    bustGrnSummaryCache();
    expect(await cachedGrnSummary(k, load)).toEqual({ n: 1 }); // stale, instant
    await vi.runAllTimersAsync();
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(2);
    expect(await cachedGrnSummary(k, load)).toEqual({ n: 2 }); // refreshed
  });

  it("recomputes after the stale window and keeps the old value when a refresh fails", async () => {
    let fail = false;
    const load = vi.fn(async () => {
      if (fail) throw new Error("db down");
      return { ok: true };
    });
    const k = summaryCacheKey({ mode: "all" });
    await cachedGrnSummary(k, load);
    vi.advanceTimersByTime(31_000);
    fail = true;
    expect(await cachedGrnSummary(k, load)).toEqual({ ok: true }); // stale served, refresh fails silently
    vi.advanceTimersByTime(11 * 60_000);
    await expect(cachedGrnSummary(k, load)).rejects.toThrow("db down");
  });
});
