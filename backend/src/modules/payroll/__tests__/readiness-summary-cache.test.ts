import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The readiness summaries recompute ~540 metric queries per call (56-67 s on production 2026-09-30)
 * and the browser aborts at 30 s while the server keeps working, so every retry started another
 * full recomputation on top of the first. Callers get identical data (the methods take only month /
 * branchId, no scope), so concurrent calls share one computation and a finished result is reused for
 * 30 s. A state-changing request clears the cache, and failures are never cached.
 */

const {
  cachedReadinessSummary,
  invalidateReadinessSummaryCache,
  READINESS_SUMMARY_TTL_MS,
  seedMonthGridOnce,
  GRID_SEED_TTL_MS,
} = await import("../payroll-readiness-summary-cache.js");

const deferred = <T,>() => {
  let resolveFn!: (v: T) => void;
  let rejectFn!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolveFn = res; rejectFn = rej; });
  return { promise, resolve: resolveFn, reject: rejectFn };
};

beforeEach(() => {
  vi.useFakeTimers();
  invalidateReadinessSummaryCache();
});
afterEach(() => vi.useRealTimers());

describe("cachedReadinessSummary", () => {
  it("concurrent identical calls share ONE computation (a retry does not start another)", async () => {
    const gate = deferred<{ n: number }[]>();
    const compute = vi.fn(() => gate.promise);
    const first = cachedReadinessSummary("ho:2026-08", compute);
    const retry = cachedReadinessSummary("ho:2026-08", compute); // the browser's retry after its abort
    gate.resolve([{ n: 1 }]);
    expect(await first).toEqual([{ n: 1 }]);
    expect(await retry).toEqual([{ n: 1 }]);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("reuses a finished result inside the TTL and recomputes after it", async () => {
    const compute = vi.fn(async () => [{ v: Date.now() }]);
    await cachedReadinessSummary("ho:2026-08", compute);
    await cachedReadinessSummary("ho:2026-08", compute);
    expect(compute).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(READINESS_SUMMARY_TTL_MS + 1);
    await cachedReadinessSummary("ho:2026-08", compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("different months / branches never share a result", async () => {
    const compute = vi.fn(async () => [{ ok: true }]);
    await cachedReadinessSummary("ho:2026-08", compute);
    await cachedReadinessSummary("ho:2026-09", compute);
    await cachedReadinessSummary("branch:2026-08:b1", compute);
    expect(compute).toHaveBeenCalledTimes(3);
  });

  it("never caches a failure: the next call computes again", async () => {
    const compute = vi.fn()
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce([{ ok: true }]);
    await expect(cachedReadinessSummary("ho:2026-08", compute)).rejects.toThrow("db down");
    await expect(cachedReadinessSummary("ho:2026-08", compute)).resolves.toEqual([{ ok: true }]);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("hands every caller a private copy, so one caller mutating it cannot corrupt the next", async () => {
    const compute = vi.fn(async () => [{ score: 50 }]);
    const a = await cachedReadinessSummary("ho:2026-08", compute);
    a[0].score = 999;
    a.push({ score: 1 });
    const b = await cachedReadinessSummary("ho:2026-08", compute);
    expect(b).toEqual([{ score: 50 }]);
  });

  it("invalidateReadinessSummaryCache forces the next call to recompute (a user's own action is never hidden)", async () => {
    const compute = vi.fn(async () => [{ frozen: 0 }]);
    await cachedReadinessSummary("ho:2026-08", compute);
    invalidateReadinessSummaryCache();
    await cachedReadinessSummary("ho:2026-08", compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });
});

describe("cacheable predicate (governance summary)", () => {
  it("never reuses a result the predicate rejects, such as an error body", async () => {
    const compute = vi.fn()
      .mockResolvedValueOnce({ status: "error", message: "engine down" })
      .mockResolvedValueOnce({ status: "checked", blockers: 0 });
    const ok = (v: { status: string }) => v.status !== "error";
    expect(await cachedReadinessSummary("gov:branch:2026-08", compute, ok)).toEqual({ status: "error", message: "engine down" });
    expect(await cachedReadinessSummary("gov:branch:2026-08", compute, ok)).toEqual({ status: "checked", blockers: 0 });
    expect(compute).toHaveBeenCalledTimes(2);
    // and the good result IS reused
    await cachedReadinessSummary("gov:branch:2026-08", compute, ok);
    expect(compute).toHaveBeenCalledTimes(2);
  });
});

describe("seedMonthGridOnce", () => {
  it("seeds once per month inside the TTL, again after it, and per month independently", async () => {
    const seed = vi.fn(async () => undefined);
    await seedMonthGridOnce("2026-08", seed);
    await seedMonthGridOnce("2026-08", seed);
    expect(seed).toHaveBeenCalledTimes(1);
    await seedMonthGridOnce("2026-09", seed);
    expect(seed).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(GRID_SEED_TTL_MS + 1);
    await seedMonthGridOnce("2026-08", seed);
    expect(seed).toHaveBeenCalledTimes(3);
  });

  it("does not remember a failed seed, so the next call retries", async () => {
    const seed = vi.fn().mockRejectedValueOnce(new Error("insert failed")).mockResolvedValueOnce(undefined);
    await expect(seedMonthGridOnce("2026-08", seed)).rejects.toThrow("insert failed");
    await seedMonthGridOnce("2026-08", seed);
    expect(seed).toHaveBeenCalledTimes(2);
  });

  it("a state-changing request resets it", async () => {
    const seed = vi.fn(async () => undefined);
    await seedMonthGridOnce("2026-08", seed);
    invalidateReadinessSummaryCache();
    await seedMonthGridOnce("2026-08", seed);
    expect(seed).toHaveBeenCalledTimes(2);
  });
});

describe("wiring", () => {
  const read = (f: string) => readFileSync(resolve(process.cwd(), "src/modules/payroll", f), "utf8");

  it("the three summary methods go through the shared cache", () => {
    const src = read("payroll-branch-readiness.service.ts");
    expect(src).toMatch(/getHOSummary\(month: string\)[\s\S]{0,120}cachedReadinessSummary\(`ho:\$\{month\}`/);
    expect(src).toMatch(/cachedReadinessSummary\(`branch:\$\{month\}:\$\{branchId\}`/);
    expect(src).toMatch(/cachedReadinessSummary\(`grouped:\$\{month\}`/);
  });

  it("both readiness routers clear the cache around any non-GET request", () => {
    for (const f of ["payroll-branch-readiness.routes.ts", "payroll-process-readiness.routes.ts"]) {
      const src = read(f);
      expect(src, f).toMatch(/req\.method !== "GET"[\s\S]{0,200}invalidateReadinessSummaryCache\(\)[\s\S]{0,120}res\.on\("finish", invalidateReadinessSummaryCache\)/);
    }
  });

  it("both summary routes use the cached governance summary and once-per-TTL grid seeding", () => {
    for (const f of ["payroll-branch-readiness.routes.ts", "payroll-process-readiness.routes.ts"]) {
      const src = read(f);
      expect(src, f).toMatch(/await getOrgWideGovernanceSummaryCached\(month\)/);
      expect(src, f).not.toMatch(/await getOrgWideGovernanceSummary\(month\)/);
      expect(src, f).toMatch(/seedMonthGridOnce\(month, \(\) => payrollBranchReadinessService\.ensureMonthGrid\(month\)\)/);
      expect(src, f).toMatch(/\(v\) => v\.status !== "error"/);
    }
  });

  it("the payroll-calculation gate still calls the governance engine directly (uncached)", () => {
    const src = read("payroll.routes.ts");
    expect(src).not.toMatch(/cachedReadinessSummary|seedMonthGridOnce/);
  });

  it("the payment gate (readiness-categories) is deliberately NOT cached", () => {
    const src = read("payroll-readiness-categories.routes.ts");
    expect(src).not.toMatch(/sharedInFlight|cachedReadinessSummary|Cache/);
  });
});
