import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * pnl-read-cache.ts — the 60s result cache + single-flight in front of the heavy P&L builders.
 *
 * The property that matters most is SCOPE SAFETY: a result computed for one caller's branch
 * entitlement must never be served to a caller with a different one. Then: identical requests
 * share one computation (concurrently and within the TTL), failures are never cached, and the
 * TTL really expires.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({
  db: { execute, query: execute, getConnection: vi.fn() },
}));

beforeEach(() => {
  vi.resetModules();
  execute.mockReset();
  execute.mockResolvedValue([[], []]);
});

afterEach(() => {
  vi.useRealTimers();
});

async function loadCache() {
  const cache = await import("../pnl-read-cache.js");
  cache.setPnlReadCacheEnabled(true);
  cache.clearPnlReadCache();
  return cache;
}

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
};

describe("pnlCacheKey", () => {
  it("gives different branch entitlements different keys", async () => {
    const { pnlCacheKey } = await loadCache();
    const a = pnlCacheKey("ceo-overview", { period: "2026-08", branchIds: ["noida"] });
    const b = pnlCacheKey("ceo-overview", { period: "2026-08", branchIds: ["pune"] });
    const all = pnlCacheKey("ceo-overview", { period: "2026-08", branchIds: [] });
    expect(new Set([a, b, all]).size).toBe(3);
  });

  it("keys on every filter: period, processIds, flags and namespace", async () => {
    const { pnlCacheKey } = await loadCache();
    const base = { period: "2026-08", branchIds: ["b1"], processIds: ["p1"], includeInactive: false };
    const key = pnlCacheKey("pnl-reconciliation", base);
    expect(pnlCacheKey("pnl-reconciliation", { ...base, period: "2026-07" })).not.toBe(key);
    expect(pnlCacheKey("pnl-reconciliation", { ...base, processIds: ["p2"] })).not.toBe(key);
    expect(pnlCacheKey("pnl-reconciliation", { ...base, processIds: [] })).not.toBe(key);
    expect(pnlCacheKey("pnl-reconciliation", { ...base, includeInactive: true })).not.toBe(key);
    expect(pnlCacheKey("ceo-overview", base)).not.toBe(key);
  });

  it("treats id lists as sets, so order and duplicates do not split the cache", async () => {
    const { pnlCacheKey } = await loadCache();
    expect(pnlCacheKey("x", { branchIds: ["b", "a", "a"], period: "2026-08" }))
      .toBe(pnlCacheKey("x", { period: "2026-08", branchIds: ["a", "b"] }));
  });
});

describe("cachedPnlRead", () => {
  it("runs one computation for concurrent identical requests (single-flight)", async () => {
    const { cachedPnlRead } = await loadCache();
    const gate = deferred<{ revenue: number }>();
    const compute = vi.fn(() => gate.promise);
    const inputs = { period: "2026-08", branchIds: ["noida"] };

    const first = cachedPnlRead("ceo-overview", inputs, compute);
    const second = cachedPnlRead("ceo-overview", { branchIds: ["noida"], period: "2026-08" }, compute);
    gate.resolve({ revenue: 42 });

    await expect(first).resolves.toEqual({ revenue: 42 });
    await expect(second).resolves.toEqual({ revenue: 42 });
    expect(compute).toHaveBeenCalledTimes(1);

    // And again within the TTL, after it settled.
    await cachedPnlRead("ceo-overview", inputs, compute);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("never serves one branch scope's result to another", async () => {
    const { cachedPnlRead, pnlReadCacheSize } = await loadCache();
    const compute = vi.fn(async (branch: string) => ({ branch, revenue: branch === "noida" ? 100 : 7 }));

    const noida = await cachedPnlRead("ceo-overview", { period: "2026-08", branchIds: ["noida"] }, () => compute("noida"));
    const pune = await cachedPnlRead("ceo-overview", { period: "2026-08", branchIds: ["pune"] }, () => compute("pune"));

    expect(noida).toEqual({ branch: "noida", revenue: 100 });
    expect(pune).toEqual({ branch: "pune", revenue: 7 });
    expect(compute).toHaveBeenCalledTimes(2);
    expect(pnlReadCacheSize()).toBe(2);
  });

  it("does not cache a failure", async () => {
    const { cachedPnlRead } = await loadCache();
    const compute = vi.fn()
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce({ ok: true });
    const inputs = { period: "2026-08", branchIds: [] };

    await expect(cachedPnlRead("pnl-reconciliation", inputs, compute)).rejects.toThrow("db down");
    await expect(cachedPnlRead("pnl-reconciliation", inputs, compute)).resolves.toEqual({ ok: true });
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("recomputes once the 60s TTL has passed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T10:00:00Z"));
    const { cachedPnlRead } = await loadCache();
    const compute = vi.fn(async () => ({ at: Date.now() }));
    const inputs = { period: "2026-08" };

    await cachedPnlRead("ceo-ytd-summary", inputs, compute);
    vi.setSystemTime(new Date("2026-09-24T10:00:59Z"));
    await cachedPnlRead("ceo-ytd-summary", inputs, compute);
    expect(compute).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-09-24T10:01:01Z"));
    await cachedPnlRead("ceo-ytd-summary", inputs, compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("is a pass-through when disabled", async () => {
    const cache = await loadCache();
    cache.setPnlReadCacheEnabled(false);
    const compute = vi.fn(async () => 1);
    await cache.cachedPnlRead("x", { period: "2026-08" }, compute);
    await cache.cachedPnlRead("x", { period: "2026-08" }, compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });
});

describe("getFullWaterfall through the cache", () => {
  it("keys on the resolved branch and shares identical requests", async () => {
    const getCachedAllocationSummary = vi.fn(async (filters: { branchId?: string }) => ({
      rows: [{ processId: `p-${filters.branchId ?? "all"}`, recognizedRevenue: filters.branchId === "b1" ? 10 : 99 }],
    }));
    vi.doMock("../canonical-pnl.service.js", () => ({ getCachedAllocationSummary }));
    const cache = await loadCache();
    const { getFullWaterfall } = await import("../bpo-pnl-full-waterfall.service.js");

    const [a1, a2] = await Promise.all([getFullWaterfall("2026-08", "b1"), getFullWaterfall("2026-08", "b1")]);
    const b = await getFullWaterfall("2026-08", "b2");
    const company = await getFullWaterfall("2026-08");

    expect(a1).toBe(a2);
    expect(a1.recognizedRevenue).toBe(10);
    expect(b.recognizedRevenue).toBe(99);
    expect(b.branchId).toBe("b2");
    expect(company.branchId).toBeNull();
    // b1 once (shared), b2 once, company once.
    expect(getCachedAllocationSummary).toHaveBeenCalledTimes(3);
    cache.setPnlReadCacheEnabled(false);
  });
});
