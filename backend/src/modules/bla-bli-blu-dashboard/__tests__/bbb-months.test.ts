import { describe, expect, it } from "vitest";
import { buildCorrectionStatus, buildMonthList, defaultMonth, monthBounds, monthLabel } from "../bbb-months.js";

describe("monthLabel / monthBounds", () => {
  it("labels months from the date, e.g. Sep-26", () => {
    expect(monthLabel("2026-08")).toBe("Aug-26");
    expect(monthLabel("2026-09")).toBe("Sep-26");
    expect(monthLabel("bad")).toBe("bad");
  });
  it("gives the first and last day of the month", () => {
    expect(monthBounds("2026-09")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(monthBounds("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(monthBounds("2026-13")).toBeNull();
  });
});

describe("buildMonthList", () => {
  it("lists every month with sales or Received Data, oldest first (Aug, Sep, Oct)", () => {
    const list = buildMonthList(
      [
        { month: "2026-09", orders: 120, realTimeSales: 100, revenue: 50000 },
        { month: "2026-08", orders: 90, realTimeSales: 80, revenue: 40000 },
      ],
      ["2026-08", "2026-10"],
    );
    expect(list.map((m) => [m.month, m.label, m.orders, m.hasReceived])).toEqual([
      ["2026-08", "Aug-26", 90, true],
      ["2026-09", "Sep-26", 120, false],
      ["2026-10", "Oct-26", 0, true],
    ]);
    expect(list[1]).toMatchObject({ from: "2026-09-01", to: "2026-09-30", realTimeSales: 100, revenue: 50000 });
  });
  it("ignores malformed month keys", () => {
    expect(buildMonthList([{ month: "null", orders: 1, realTimeSales: 0, revenue: 0 }], ["x"])).toEqual([]);
  });
});

describe("defaultMonth", () => {
  const list = [{ month: "2026-08" }, { month: "2026-09" }];
  it("keeps the requested month when it has data, else opens the newest month with data", () => {
    expect(defaultMonth(list, "2026-08")).toBe("2026-08");
    expect(defaultMonth(list, "2026-10")).toBe("2026-09");
    expect(defaultMonth([], "2026-10")).toBe("2026-10");
  });
});

describe("buildCorrectionStatus", () => {
  const up = (reportDate: string, batchId: string, uploadedAt: string, existingCount: number, uploadCount: number) => ({
    reportDate, batchId, batchNo: batchId, fileName: null, uploadedAt, existingCount, uploadCount,
    updatedCount: Math.min(existingCount, uploadCount), insertedCount: Math.max(0, uploadCount - existingCount), afterCount: 0,
  });
  it("uses the latest upload per date, variance = upload - existing, and flags duplicates", () => {
    const s = buildCorrectionStatus(
      [up("2026-08-01", "b1", "2026-08-02T10:00:00.000Z", 0, 50), up("2026-08-01", "b2", "2026-10-10T10:00:00.000Z", 50, 47), up("2026-08-02", "b2", "2026-10-10T10:00:00.000Z", 40, 44)],
      new Map([["2026-08-01", { rows: 47, distinctOrders: 47 }], ["2026-08-02", { rows: 45, distinctOrders: 44 }]]),
    );
    expect(s.map((r) => [r.reportDate, r.batchId, r.variance, r.currentCount, r.duplicateCount, r.uploadsForDate])).toEqual([
      ["2026-08-01", "b2", -3, 47, 0, 2],
      ["2026-08-02", "b2", 4, 45, 1, 1],
    ]);
  });
});
