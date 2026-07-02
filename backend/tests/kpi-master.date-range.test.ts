import { describe, expect, it } from "vitest";
import { getDateRange } from "../src/modules/kpi/kpi-master.service.js";

describe("getDateRange with an explicit performance date", () => {
  it("returns the selected date for a daily view", () => {
    expect(getDateRange("day", "2026-06-14")).toEqual({
      start: "2026-06-14",
      end: "2026-06-14",
    });
  });

  it("anchors week-to-date on the selected date", () => {
    expect(getDateRange("wtd", "2026-06-14")).toEqual({
      start: "2026-06-08",
      end: "2026-06-14",
    });
  });

  it("anchors month-to-date on the selected date", () => {
    expect(getDateRange("mtd", "2026-06-14")).toEqual({
      start: "2026-06-01",
      end: "2026-06-14",
    });
  });
});
