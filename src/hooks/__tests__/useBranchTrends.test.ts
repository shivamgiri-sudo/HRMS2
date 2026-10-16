import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/hrmsApi", () => ({ hrmsApi: { get: mocks.get } }));

import { fetchTrend, fetchTrendPoints, trendPoints, trendQueryKey, trendValues, TREND_DAYS } from "../useBranchTrends";

describe("trendValues", () => {
  it("sorts by date ascending and maps non-finite values to null", () => {
    expect(trendValues([
      { date: "2026-10-03", value: 3 },
      { date: "2026-10-01", value: 1 },
      { date: "2026-10-02", value: Number.NaN },
      { date: "2026-10-04", value: null },
      { date: "2026-10-05", value: "7" },
    ])).toEqual([1, null, 3, null, null]);
  });
  it("returns [] for missing or non-array input", () => {
    expect(trendValues(undefined)).toEqual([]);
    expect(trendValues(null)).toEqual([]);
    expect(trendValues({} as never)).toEqual([]);
  });
});

describe("trendPoints", () => {
  it("keeps the date (YYYY-MM-DD) with each value, oldest first", () => {
    expect(trendPoints([{ date: "2026-10-03T00:00:00Z", value: 3 }, { date: "2026-10-01", value: Number.NaN }])).toEqual([
      { date: "2026-10-01", value: null }, { date: "2026-10-03", value: 3 },
    ]);
    expect(trendPoints(undefined)).toEqual([]);
  });
});

describe("trend fetch", () => {
  beforeEach(() => mocks.get.mockReset());
  it("query key carries branch, metric and days", () => {
    expect(TREND_DAYS).toBe(14);
    expect(trendQueryKey("b1", "score")).toEqual(["branch-head-health-trend", "b1", "score", 14]);
  });
  it("calls the trend endpoint with branchId, metric and 14 days", async () => {
    mocks.get.mockResolvedValue({ success: true, data: [{ date: "2026-10-02", value: 2 }, { date: "2026-10-01", value: 1 }] });
    expect(await fetchTrend("b 1", "shrinkagePct")).toEqual([1, 2]);
    expect(await fetchTrendPoints("b 1", "shrinkagePct")).toEqual([{ date: "2026-10-01", value: 1 }, { date: "2026-10-02", value: 2 }]);
    const url = String(mocks.get.mock.calls[0][0]);
    expect(url.startsWith("/api/branch-head-health/trend?")).toBe(true);
    const q = new URLSearchParams(url.split("?")[1]);
    expect(q.get("branchId")).toBe("b 1");
    expect(q.get("metric")).toBe("shrinkagePct");
    expect(q.get("days")).toBe("14");
  });
  it("never throws: a failed request or a bad body gives []", async () => {
    mocks.get.mockRejectedValue(new Error("500"));
    expect(await fetchTrend("b1", "score")).toEqual([]);
    expect(await fetchTrendPoints("b1", "score")).toEqual([]);
    mocks.get.mockResolvedValue(undefined);
    expect(await fetchTrend("b1", "score")).toEqual([]);
  });
});
