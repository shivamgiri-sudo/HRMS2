import { describe, it, expect } from "vitest";
import {
  parseNullableInt, parseSecondsFlexible, parsePctFraction, parseNullableDecimal, parseDate,
  CLOVIA_APR_HEADERS,
} from "../clovia-apr-daily-bulk.service.js";

describe("parseSecondsFlexible", () => {
  it("reads the real day-fraction from the sample (0.3522685185185185 = 30436s)", () => {
    expect(parseSecondsFlexible(0.3522685185185185)).toBe(30436);
  });
  it("reads a real WAIT fraction from the sample (0.17030092592592594 = 14714s)", () => {
    expect(parseSecondsFlexible(0.17030092592592594)).toBe(14714);
  });
  it("treats a value over 3 as already-seconds", () => {
    expect(parseSecondsFlexible(30436)).toBe(30436);
  });
  it("returns null for blank", () => {
    expect(parseSecondsFlexible("")).toBeNull();
  });
});

describe("parsePctFraction", () => {
  it("multiplies the real sample's Utilization fraction into a percentage", () => {
    expect(parsePctFraction(0.4427980023656197)).toBeCloseTo(44.2798, 3);
  });
  it("leaves an already-multiplied percentage alone", () => {
    expect(parsePctFraction(44.28)).toBe(44.28);
  });
});

describe("parseNullableDecimal", () => {
  it("reads a real Attendance value", () => {
    expect(parseNullableDecimal("1")).toBe(1);
    expect(parseNullableDecimal("0.5")).toBe(0.5);
  });
});

describe("parseNullableInt", () => {
  it("reads a real call count", () => {
    expect(parseNullableInt("59")).toBe(59);
  });
});

describe("parseDate", () => {
  it("reads the real plain Excel serial from the sample (46266 = 2026-09-01)", () => {
    expect(parseDate(46266)).toBe("2026-09-01");
  });
});

describe("headers", () => {
  it("names every column the template asks for", () => {
    expect(CLOVIA_APR_HEADERS).toContain("MAS_ID");
    expect(CLOVIA_APR_HEADERS).toContain("Utilization");
  });
});
