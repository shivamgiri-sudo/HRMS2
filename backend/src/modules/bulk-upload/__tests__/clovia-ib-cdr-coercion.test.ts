import { describe, it, expect } from "vitest";
import {
  parseNullableInt, parseSecondsFlexible, parseDate, parseCallTime, CLOVIA_IB_CDR_HEADERS,
} from "../clovia-ib-cdr-bulk.service.js";

/** Callduration/Queue Duration are day-fraction decimals; ACW Duration is plain seconds already. */
describe("parseSecondsFlexible", () => {
  it("reads the real day-fraction Callduration from the sample (0.0021296296296296298 = 184s)", () => {
    expect(parseSecondsFlexible(0.0021296296296296298)).toBe(184);
  });
  it("reads the real plain-seconds ACW Duration from the sample (58) without misreading it as a day fraction", () => {
    expect(parseSecondsFlexible(58)).toBe(58);
  });
  it("returns null for blank (the real sample's Hold Time is often blank)", () => {
    expect(parseSecondsFlexible("")).toBeNull();
    expect(parseSecondsFlexible(null)).toBeNull();
  });
  /**
   * Regression: an earlier <= 3 cutoff misread a plain 3-second ACW
   * duration as "3 days" (259,200 seconds) -- caught live while writing
   * this file's own end-to-end verification script.
   */
  it("treats a small plain-seconds value as seconds, not a day fraction (caught live 2026-09-09)", () => {
    expect(parseSecondsFlexible(3)).toBe(3);
    expect(parseSecondsFlexible(2)).toBe(2);
  });
});

/** CallTime is a FRACTIONAL Excel serial (date + time-of-day). */
describe("parseCallTime", () => {
  it("reads the real fractional CallTime serial from the sample (46266.39702546296 = 2026-09-01 09:31:43)", () => {
    expect(parseCallTime(46266.39702546296)).toBe("2026-09-01 09:31:43");
  });
  it("still reads a plain date+time text string", () => {
    expect(parseCallTime("2026-09-01 09:31:43")).toBe("2026-09-01 09:31:43");
  });
});

describe("parseDate", () => {
  it("reads the real plain CallDate Excel serial from the sample (46266 = 2026-09-01)", () => {
    expect(parseDate(46266)).toBe("2026-09-01");
  });
});

describe("parseNullableInt", () => {
  it("reads the real row-identity Count value", () => {
    expect(parseNullableInt("1")).toBe(1);
    expect(parseNullableInt("2")).toBe(2);
  });
});

describe("headers", () => {
  it("names every column the template asks for", () => {
    expect(CLOVIA_IB_CDR_HEADERS).toContain("Phone_Number");
    expect(CLOVIA_IB_CDR_HEADERS).toContain("Count");
  });
});
