import { describe, expect, it } from "vitest";
import { formatInr, formatPct, scoreBand } from "../format";

describe("format", () => {
  it("scoreBand boundaries", () => {
    expect(scoreBand(75)).toEqual({ label: "Good", icon: "check" });
    expect(scoreBand(74.99).label).toBe("Fair");
    expect(scoreBand(50)).toEqual({ label: "Fair", icon: "alert" });
    expect(scoreBand(49.99)).toEqual({ label: "Poor", icon: "x" });
  });
  it("formatInr", () => {
    expect(formatInr(0)).toBe("₹0");
    expect(formatInr(null)).toBe("—");
    expect(formatInr(undefined)).toBe("—");
    expect(formatInr(6016216.8)).toBe("₹60.2 L");
    expect(formatInr(1500000000)).toBe("₹150 Cr");
    expect(formatInr(14000000)).toBe("₹1.4 Cr");
    expect(formatInr(99999)).toBe("₹99,999");
    expect(formatInr(-6016216.8)).toBe("-₹60.2 L");
    expect(formatInr(-1234)).toBe("-₹1,234");
  });
  it("formatPct", () => {
    expect(formatPct(12.345)).toBe("12.3%");
    expect(formatPct(null)).toBe("—");
  });
});
