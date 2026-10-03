import { describe, expect, it } from "vitest";
import { parseRosterDeepLink, weekContaining } from "../rosterDeepLink";

const p = (qs: string) => parseRosterDeepLink(new URLSearchParams(qs));

describe("parseRosterDeepLink", () => {
  it("reads a valid date and employee", () => {
    expect(p("tab=roster&date=2026-10-07&employee=e-123")).toEqual({ date: "2026-10-07", employeeId: "e-123" });
  });

  it("returns nulls when both are absent", () => {
    expect(p("tab=roster")).toEqual({ date: null, employeeId: null });
  });

  it.each(["2026-13-01", "2026-02-30", "07-10-2026", "2026-10-7", "tomorrow", "", "2026-10-07T00:00"])("ignores the invalid date %j", (d) => {
    expect(p(`date=${encodeURIComponent(d)}`).date).toBeNull();
  });

  it("accepts a leap day only in a leap year", () => {
    expect(p("date=2028-02-29").date).toBe("2028-02-29");
    expect(p("date=2026-02-29").date).toBeNull();
  });

  it("ignores a blank or malformed employee id", () => {
    expect(p("employee=").employeeId).toBeNull();
    expect(p("employee=%20%20").employeeId).toBeNull();
    expect(p(`employee=${encodeURIComponent("e1'; DROP")}`).employeeId).toBeNull();
    expect(p(`employee=${"a".repeat(65)}`).employeeId).toBeNull();
    expect(p("employee=%20e1%20").employeeId).toBe("e1");
  });
});

describe("weekContaining", () => {
  it("is the Monday-to-Sunday week of the date", () => {
    expect(weekContaining("2026-10-07")).toEqual({ from: "2026-10-05", to: "2026-10-11" }); // Wednesday
    expect(weekContaining("2026-10-05")).toEqual({ from: "2026-10-05", to: "2026-10-11" }); // Monday
    expect(weekContaining("2026-10-11")).toEqual({ from: "2026-10-05", to: "2026-10-11" }); // Sunday
    expect(weekContaining("2026-01-01")).toEqual({ from: "2025-12-29", to: "2026-01-04" }); // across a year end
  });
});
