import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TtlCache, cachedOr, withTimeout } from "../cache.js";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-15T00:00:00Z")); });
afterEach(() => { vi.useRealTimers(); });

describe("TtlCache / cachedOr", () => {
  it("second call within TTL does not re-fetch; expiry re-fetches", async () => {
    const c = new TtlCache<number>(60_000, 64);
    const fn = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    expect(await cachedOr(c, "k", fn)).toBe(1);
    vi.advanceTimersByTime(59_000);
    expect(await cachedOr(c, "k", fn)).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2_000);
    expect(await cachedOr(c, "k", fn)).toBe(2);
    expect(fn).toHaveBeenCalledTimes(2);
  });
  it("never caches a throw or a vetoed value", async () => {
    const c = new TtlCache<number>();
    const fn = vi.fn().mockRejectedValueOnce(new Error("x")).mockResolvedValue(5);
    await expect(cachedOr(c, "k", fn)).rejects.toThrow();
    expect(await cachedOr(c, "k", fn, () => false)).toBe(5);
    expect(await cachedOr(c, "k", fn)).toBe(5);
    expect(fn).toHaveBeenCalledTimes(3);
  });
  it("evicts the oldest entry beyond max size (FIFO)", () => {
    const c = new TtlCache<number>(60_000, 2);
    c.set("a", 1); c.set("b", 2); c.set("c", 3);
    expect(c.get("a")).toBeUndefined();
    expect(c.get("b")).toBe(2);
    expect(c.get("c")).toBe(3);
  });
});

describe("withTimeout", () => {
  it("a hung promise yields the fallback and clears the timer", async () => {
    const p = withTimeout(new Promise<string>(() => {}), 20_000, () => "timed out");
    vi.advanceTimersByTime(20_000);
    expect(await p).toBe("timed out");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("a fast promise wins and no timer is left", async () => {
    expect(await withTimeout(Promise.resolve("ok"), 20_000, () => "late")).toBe("ok");
    expect(vi.getTimerCount()).toBe(0);
  });
});
