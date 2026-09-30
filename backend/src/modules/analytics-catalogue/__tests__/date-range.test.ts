import { describe, it, expect } from "vitest";
import { resolveRange, shiftRange } from "../date-range.js";

const NOW = new Date(2026, 8, 30); // 30 Sep 2026, local time

describe("resolveRange", () => {
  it("last_7 includes today", () => expect(resolveRange({ preset: "last_7" }, NOW)).toEqual({ from: "2026-09-24", to: "2026-09-30" }));
  it("today / yesterday", () => {
    expect(resolveRange({ preset: "today" }, NOW)).toEqual({ from: "2026-09-30", to: "2026-09-30" });
    expect(resolveRange({ preset: "yesterday" }, NOW)).toEqual({ from: "2026-09-29", to: "2026-09-29" });
  });
  it("this_week starts Monday", () => expect(resolveRange({ preset: "this_week" }, NOW)).toEqual({ from: "2026-09-28", to: "2026-09-30" }));
  it("month presets", () => {
    expect(resolveRange({ preset: "this_month" }, NOW)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(resolveRange({ preset: "last_month" }, NOW)).toEqual({ from: "2026-08-01", to: "2026-08-31" });
  });
  it("quarter and year", () => {
    expect(resolveRange({ preset: "this_quarter" }, NOW)).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(resolveRange({ preset: "this_year" }, NOW)).toEqual({ from: "2026-01-01", to: "2026-09-30" });
  });
  it("all means no range", () => expect(resolveRange({ preset: "all" }, NOW)).toBeNull());
  it("custom validates and swaps reversed dates", () => {
    expect(resolveRange({ preset: "custom", from: "2026-09-10", to: "2026-09-01" }, NOW)).toEqual({ from: "2026-09-01", to: "2026-09-10" });
    expect(() => resolveRange({ preset: "custom", from: "10/09/2026", to: "2026-09-01" }, NOW)).toThrow(/YYYY-MM-DD/);
  });
  it("defaults to last_30 when missing", () => expect(resolveRange(undefined, NOW)).toEqual({ from: "2026-09-01", to: "2026-09-30" }));
});

describe("shiftRange", () => {
  it("previous period is the same length immediately before", () =>
    expect(shiftRange({ from: "2026-09-24", to: "2026-09-30" }, "previous_period")).toEqual({ from: "2026-09-17", to: "2026-09-23" }));
  it("previous year keeps the calendar dates", () =>
    expect(shiftRange({ from: "2026-09-24", to: "2026-09-30" }, "previous_year")).toEqual({ from: "2025-09-24", to: "2025-09-30" }));
});
