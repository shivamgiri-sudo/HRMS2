import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const loadReport = vi.fn();
const buildOpsSections = vi.fn();
const buildProcessPnl = vi.fn();
vi.mock("../overview.js", () => ({ loadReport: (...a: unknown[]) => loadReport(...a) }));
vi.mock("../ops.js", () => ({ buildOpsSections: (...a: unknown[]) => buildOpsSections(...a), SECTION_TIMEOUT_MS: 20_000 }));
vi.mock("../pnl.js", () => ({ buildProcessPnl: (...a: unknown[]) => buildProcessPnl(...a) }));

import { cachedOr, TtlCache } from "../cache.js";
import { getReportCached, getOpsCached, isOpsFresh, getPnlCached, clearBranchHeadHealthCaches, PNL_TIMEOUT_MS, TTL_MS, STILL_CALCULATING } from "../loaders.js";

const b = { branchId: "b1", branchCode: "C1", branchName: "One" };
const okSec = { status: "ok", data: {}, asOf: "2026-10-15" };
const range = { startDate: "2026-10-01", endDate: "2026-10-15" };

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-15T00:00:00Z"));
  [loadReport, buildOpsSections, buildProcessPnl].forEach((m) => m.mockReset());
  clearBranchHeadHealthCaches();
});
afterEach(() => { vi.useRealTimers(); });

describe("loaders", () => {
  it("TTL is 5 minutes", () => { expect(TTL_MS).toBe(300_000); });
  it("second call within TTL is a hit; expiry re-runs", async () => {
    loadReport.mockResolvedValue({ n: 1 });
    await getReportCached(b, "2026-10-15");
    vi.advanceTimersByTime(299_000);
    await getReportCached(b, "2026-10-15");
    expect(loadReport).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2_000);
    await getReportCached(b, "2026-10-15");
    expect(loadReport).toHaveBeenCalledTimes(2);
  });
  it("errors are not cached", async () => {
    loadReport.mockRejectedValueOnce(new Error("x")).mockResolvedValue({ n: 2 });
    await expect(getReportCached(b, "d")).rejects.toThrow("x");
    expect(await getReportCached(b, "d")).toEqual({ n: 2 });
    expect(loadReport).toHaveBeenCalledTimes(2);
  });
  it("ops sections containing an error are not cached", async () => {
    buildOpsSections.mockResolvedValue({ operations: { ...okSec, status: "error" }, quality: okSec, callmaster: okSec });
    await getOpsCached(b, [], range, "2026-10-15");
    await getOpsCached(b, [], range, "2026-10-15");
    expect(buildOpsSections).toHaveBeenCalledTimes(2);
  });
  it("concurrent calls share one loader run", async () => {
    let resolve!: (v: unknown) => void;
    loadReport.mockImplementation(() => new Promise((r) => { resolve = r; }));
    const p1 = getReportCached(b, "d"); const p2 = getReportCached(b, "d");
    await vi.advanceTimersByTimeAsync(0);
    resolve({ n: 1 });
    expect(await p1).toEqual(await p2);
    expect(loadReport).toHaveBeenCalledTimes(1);
  });
  it("late fill: timeout returns the Still calculating fallback, later call is a hit", async () => {
    let resolve!: (v: unknown) => void;
    buildProcessPnl.mockImplementation(() => new Promise((r) => { resolve = r; }));
    const p = getPnlCached(b, "2026-10-15");
    await vi.advanceTimersByTimeAsync(PNL_TIMEOUT_MS + 1);
    const first = await p;
    expect(first).toEqual({ status: "error", data: null, asOf: "2026-10-15", message: STILL_CALCULATING });
    expect(STILL_CALCULATING).toBe("Still calculating - first load of a month can take up to a minute. Refresh shortly.");
    resolve(okSec);
    await vi.advanceTimersByTimeAsync(0);
    expect(await getPnlCached(b, "2026-10-15")).toEqual(okSec);
    expect(buildProcessPnl).toHaveBeenCalledTimes(1);
  });
  it("late rejection produces no unhandled rejection", async () => {
    const seen: unknown[] = [];
    const h = (e: unknown) => seen.push(e);
    process.on("unhandledRejection", h);
    let reject!: (e: Error) => void;
    buildProcessPnl.mockImplementation(() => new Promise((_, r) => { reject = r; }));
    const p = getPnlCached(b, "2026-10-15");
    await vi.advanceTimersByTimeAsync(PNL_TIMEOUT_MS + 1);
    await p;
    reject(new Error("late"));
    vi.useRealTimers();
    await new Promise((r) => setImmediate(r));
    process.off("unhandledRejection", h);
    expect(seen).toEqual([]);
  });

  it("a synchronously throwing loader does not poison the key", async () => {
    const c = new TtlCache<number>(300_000, 8);
    await expect(cachedOr(c, "k", (() => { throw new Error("sync"); }) as any)).rejects.toThrow("sync");
    expect(await cachedOr(c, "k", async () => 7)).toBe(7);
  });
  it("ops cache key includes the process list: different lists do not collide", async () => {
    buildOpsSections.mockResolvedValue({ operations: okSec, quality: okSec, callmaster: okSec });
    await getOpsCached(b, [{ processId: "p1" } as any], range, "2026-10-15");
    await getOpsCached(b, [{ processId: "p2" } as any], range, "2026-10-15");
    await getOpsCached(b, [{ processId: "p2" } as any], range, "2026-10-15");
    expect(buildOpsSections).toHaveBeenCalledTimes(2);
  });
  it("refresh-ahead: warm pass refreshes at 4 min, not at 1 min; a reader at 4.5 min still hits", async () => {
    loadReport.mockResolvedValue({ n: 1 });
    await getReportCached(b, "d");
    vi.advanceTimersByTime(60_000);
    await getReportCached(b, "d", { warm: true });
    expect(loadReport).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(180_000); // 4 min old
    loadReport.mockResolvedValue({ n: 2 });
    expect(await getReportCached(b, "d", { warm: true })).toEqual({ n: 2 });
    expect(loadReport).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(270_000); // 4.5 min after the refresh
    expect(await getReportCached(b, "d")).toEqual({ n: 2 });
    expect(loadReport).toHaveBeenCalledTimes(2);
  });
  it("isOpsFresh follows the refresh-ahead rule", async () => {
    buildOpsSections.mockResolvedValue({ operations: okSec, quality: okSec, callmaster: okSec });
    expect(isOpsFresh(b, "2026-10-15")).toBe(false);
    await getOpsCached(b, [], range, "2026-10-15");
    expect(isOpsFresh(b, "2026-10-15")).toBe(true);
    vi.advanceTimersByTime(220_000);
    expect(isOpsFresh(b, "2026-10-15")).toBe(false);
  });
});
