import { describe, expect, it } from "vitest";
import { monthBounds } from "../month-bounds.util.js";

describe("monthBounds", () => {
  it("returns first day of month and of next month", () => {
    expect(monthBounds("2026-09")).toEqual(["2026-09-01", "2026-10-01"]);
  });
  it("rolls over the year", () => {
    expect(monthBounds("2026-12")).toEqual(["2026-12-01", "2027-01-01"]);
  });
  it("returns nulls (match nothing) for invalid input", () => {
    expect(monthBounds("2026-13")).toEqual([null, null]);
    expect(monthBounds("2026-9")).toEqual([null, null]);
    expect(monthBounds("abc")).toEqual([null, null]);
  });
});
