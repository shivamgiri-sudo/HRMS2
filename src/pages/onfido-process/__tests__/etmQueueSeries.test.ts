import { describe, expect, it } from "vitest";
import { etmTrendTitle, pickEtmQueueSeries } from "../etmQueueSeries";

describe("etmQueueSeries", () => {
  const pts = [{ bucket: "Jan", doc: 5, poa: 2 }, { bucket: "Feb", doc: 7, poa: 0 }];
  it("returns only DOC counts", () => {
    expect(pickEtmQueueSeries(pts, "doc")).toEqual([{ bucket: "Jan", count: 5 }, { bucket: "Feb", count: 7 }]);
  });
  it("returns only POA counts", () => {
    expect(pickEtmQueueSeries(pts, "poa")).toEqual([{ bucket: "Jan", count: 2 }, { bucket: "Feb", count: 0 }]);
  });
  it("title follows granularity", () => {
    expect(etmTrendTitle("DOC ETM", "weekly")).toBe("DOC ETM · Week-wise Trend");
    expect(etmTrendTitle("POA ETM", "monthly")).toBe("POA ETM · Month-wise Trend");
  });
});
