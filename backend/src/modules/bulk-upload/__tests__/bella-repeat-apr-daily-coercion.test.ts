import { describe, it, expect } from "vitest";
import {
  parseNullableInt, parseSecondsFlexible, parsePctFraction, parseNullableDecimal, parseDate,
  BELLA_REPEAT_APR_HEADERS,
} from "../bella-repeat-apr-daily-bulk.service.js";

describe("parseSecondsFlexible", () => {
  it("reads the real day-fraction Login Time from the sample (0.3902777777777778 = 33720s)", () => {
    expect(parseSecondsFlexible(0.3902777777777778)).toBe(33720);
  });
  it("reads the real Net Login Hrs+DN+Briefing fraction from the sample (0.4100462962962963 = 35428s)", () => {
    expect(parseSecondsFlexible(0.4100462962962963)).toBe(35428);
  });
  it("treats the real plain-seconds ACHT from the sample (36) as seconds, not a day fraction", () => {
    expect(parseSecondsFlexible(36)).toBe(36);
  });
});

describe("parsePctFraction", () => {
  it("multiplies the real sample's Utilization fraction into a percentage", () => {
    expect(parsePctFraction(0.40077194781518827)).toBeCloseTo(40.0772, 3);
  });
});

describe("parseNullableDecimal", () => {
  it("treats the real sample's '-' placeholder as null", () => {
    expect(parseNullableDecimal("-")).toBeNull();
  });
  it("reads a real Attendance value", () => {
    expect(parseNullableDecimal("1")).toBe(1);
  });
});

describe("parseNullableInt", () => {
  it("reads a real call count", () => {
    expect(parseNullableInt("561")).toBe(561);
  });
});

describe("parseDate", () => {
  it("reads the real plain Excel serial from the sample (46204 = 2026-07-01)", () => {
    expect(parseDate(46204)).toBe("2026-07-01");
  });
});

describe("headers", () => {
  it("names every column the template asks for", () => {
    expect(BELLA_REPEAT_APR_HEADERS).toContain("NOIID");
    expect(BELLA_REPEAT_APR_HEADERS).toContain("Utilization");
  });
});
