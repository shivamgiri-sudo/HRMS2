import { describe, expect, it } from "vitest";
import { TtlCache } from "../ttlCache.js";

describe("TtlCache stale-while-revalidate", () => {
  it("serves the expired value instantly and refreshes once in the background", async () => {
    let t = 0;
    const cache = new TtlCache<number>({ defaultTtlMs: 100, defaultStaleMs: 1_000, now: () => t });
    let computes = 0;
    const compute = async () => { computes += 1; return computes; };

    expect((await cache.getOrCompute("k", compute)).value).toBe(1);
    t = 50;
    expect(await cache.getOrCompute("k", compute)).toEqual({ value: 1, hit: true });
    expect(computes).toBe(1);

    t = 500; // expired, inside the stale window
    const [a, b] = await Promise.all([cache.getOrCompute("k", compute), cache.getOrCompute("k", compute)]);
    expect(a).toEqual({ value: 1, hit: true });
    expect(b).toEqual({ value: 1, hit: true });
    await new Promise((r) => setTimeout(r, 10));
    expect(computes).toBe(2); // one shared refresh, not one per caller
    expect((await cache.getOrCompute("k", compute)).value).toBe(2);
  });

  it("keeps serving the stale value when the refresh fails, and never throws to the caller", async () => {
    let t = 0;
    const cache = new TtlCache<string>({ defaultTtlMs: 100, defaultStaleMs: 1_000, now: () => t });
    await cache.getOrCompute("k", async () => "good");
    t = 500;
    const r = await cache.getOrCompute("k", async () => { throw new Error("db down"); });
    expect(r.value).toBe("good");
    await new Promise((r2) => setTimeout(r2, 10));
    expect((await cache.getOrCompute("k", async () => { throw new Error("still down"); })).value).toBe("good");
  });

  it("recomputes synchronously once past the stale window", async () => {
    let t = 0;
    const cache = new TtlCache<number>({ defaultTtlMs: 100, defaultStaleMs: 1_000, now: () => t });
    await cache.getOrCompute("k", async () => 1);
    t = 5_000;
    expect(await cache.getOrCompute("k", async () => 2)).toEqual({ value: 2, hit: false });
  });

  it("is off by default (staleMs 0 behaves exactly like before)", async () => {
    let t = 0;
    const cache = new TtlCache<number>({ defaultTtlMs: 100, now: () => t });
    await cache.getOrCompute("k", async () => 1);
    t = 150;
    expect(await cache.getOrCompute("k", async () => 2)).toEqual({ value: 2, hit: false });
  });
});
