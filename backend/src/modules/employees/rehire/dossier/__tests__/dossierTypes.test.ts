import { describe, it, expect } from "vitest";
import { buildWindow, settle, num, numOrNull, round1 } from "../dossierTypes.js";

describe("buildWindow", () => {
  it("covers 12 months ending in the as-of month", () => {
    const w = buildWindow("e1", "2026-09-10", 12);
    expect(w.months).toHaveLength(12);
    expect(w.months[0]).toBe("2025-10");
    expect(w.months[11]).toBe("2026-09");
    expect(w.start).toBe("2025-10-01");
    expect(w.end).toBe("2026-09-10");
    expect(w.employeeId).toBe("e1");
  });

  it("crosses a year boundary", () => {
    expect(buildWindow("e1", "2026-01-15", 3).months).toEqual(["2025-11", "2025-12", "2026-01"]);
  });

  it("accepts a datetime string as the as-of date", () => {
    expect(buildWindow("e1", "2026-09-10T00:00:00.000Z", 1).end).toBe("2026-09-10");
  });
});

describe("settle", () => {
  it("wraps a value", async () => {
    expect(await settle(async () => 5)).toEqual({ status: "ok", data: 5 });
  });
  it("turns a throw into an error section instead of rejecting", async () => {
    const r = await settle(async () => { throw new Error("boom"); });
    expect(r).toEqual({ status: "error", error: "boom" });
  });
});

describe("number helpers", () => {
  it("num coerces mysql2 decimal strings and defaults to 0", () => {
    expect(num("12.50")).toBe(12.5);
    expect(num(null)).toBe(0);
    expect(num(undefined)).toBe(0);
    expect(num("abc")).toBe(0);
  });
  it("numOrNull keeps null", () => {
    expect(numOrNull(null)).toBeNull();
    expect(numOrNull("3")).toBe(3);
  });
  it("round1 rounds to one decimal", () => {
    expect(round1(94.449)).toBe(94.4);
    expect(round1(94.45)).toBe(94.5);
  });
});
