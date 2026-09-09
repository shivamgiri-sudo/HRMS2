import { describe, it, expect } from "vitest";
import {
  parseNullableAmount, parseNullableInt, parseAchPct, parseDate, parseReportPeriod,
  HOUSING_PREMIUM_AGENT_TARGET_HEADERS,
} from "../housing-premium-agent-target-bulk.service.js";

/** The real sample uses a literal "-" for an InActive agent's Target/Ach%. */
describe("parseNullableAmount", () => {
  it("treats the real sample's '-' placeholder as null, not zero", () => {
    expect(parseNullableAmount("-")).toBeNull();
  });
  it("reads a real target amount", () => {
    expect(parseNullableAmount("80000")).toBe(80000);
  });
});

describe("parseNullableInt", () => {
  it("treats '-' as null", () => {
    expect(parseNullableInt("-")).toBeNull();
  });
  it("reads a real tenure value", () => {
    expect(parseNullableInt("161")).toBe(161);
  });
});

/** Ach_Pct in the real sample is a plain fraction (0.949825 = 94.98%). */
describe("parseAchPct", () => {
  it("multiplies the real sample's fraction into a percentage", () => {
    expect(parseAchPct("0.949825")).toBeCloseTo(94.9825, 3);
  });
  it("reads the real over-100% achievement correctly (2.1032454545454544 = 210.3%)", () => {
    expect(parseAchPct("2.1032454545454544")).toBeCloseTo(210.32, 1);
  });
  it("treats '-' as null", () => {
    expect(parseAchPct("-")).toBeNull();
  });
});

describe("parseDate", () => {
  it("reads the real DOJ Excel serial from the sample (46102 = 2026-03-21)", () => {
    expect(parseDate(46102)).toBe("2026-03-21");
  });
});

describe("parseReportPeriod", () => {
  it("accepts a real YYYY-MM value", () => {
    expect(parseReportPeriod("2026-08")).toBe("2026-08");
  });
  it("refuses anything else rather than inventing a period", () => {
    expect(parseReportPeriod("Aug 2026")).toBeNull();
    expect(parseReportPeriod("2026-13")).toBeNull();
    expect(parseReportPeriod("")).toBeNull();
  });
});

describe("headers", () => {
  it("names every column the template asks for", () => {
    expect(HOUSING_PREMIUM_AGENT_TARGET_HEADERS).toContain("Emp_ID");
    expect(HOUSING_PREMIUM_AGENT_TARGET_HEADERS).toContain("Report_Period");
  });
});
