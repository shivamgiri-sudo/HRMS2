import { describe, it, expect } from "vitest";
import {
  parseCount, parseSecondsFlexible, parseUtilizationPct, parseDate, DU_APR_HEADERS,
} from "../du-apr-daily-bulk.service.js";

describe("parseCount", () => {
  it("treats a blank as zero", () => {
    expect(parseCount("")).toBe(0);
  });
  it("reads a real call count", () => {
    expect(parseCount("20")).toBe(20);
  });
});

/**
 * The real source's durations are day-fraction decimals, e.g.
 * LOGINTIME = 0.41737268518518517 = 36061 seconds (Login Time In Sec,
 * the source's own cross-check column, matches to the second).
 */
describe("parseSecondsFlexible", () => {
  it("reads the real day-fraction from the Korea sample (0.41737268518518517 = 36061s)", () => {
    expect(parseSecondsFlexible(0.41737268518518517)).toBe(36061);
  });
  it("reads a real WAIT fraction from the sample (0.3327199074074074 = 28747s)", () => {
    expect(parseSecondsFlexible(0.3327199074074074)).toBe(28747);
  });
  it("treats a value over 3 as already-seconds, not a day fraction", () => {
    expect(parseSecondsFlexible(36061)).toBe(36061);
  });
  it("still reads HH:MM:SS text, for a re-exported sheet", () => {
    expect(parseSecondsFlexible("10:01:01")).toBe(36061);
  });
  it("returns 0 for blank", () => {
    expect(parseSecondsFlexible("")).toBe(0);
  });
});

/** The real source's Utilization % is a plain fraction, not pre-multiplied. */
describe("parseUtilizationPct", () => {
  it("multiplies the real sample fraction into a percentage (0.1503768287276489 -> ~15.04)", () => {
    expect(parseUtilizationPct(0.1503768287276489)).toBeCloseTo(15.0377, 3);
  });
  it("leaves an already-multiplied percentage alone", () => {
    expect(parseUtilizationPct(15.04)).toBe(15.04);
  });
  it("returns null for blank", () => {
    expect(parseUtilizationPct("")).toBeNull();
  });
});

describe("parseDate", () => {
  it("reads the real plain Excel serial from the sample (46267 = 2026-09-02)", () => {
    expect(parseDate(46267)).toBe("2026-09-02");
  });
  it("reads a normal ISO date string", () => {
    expect(parseDate("2026-09-08")).toBe("2026-09-08");
  });
  it("refuses garbage rather than inventing a date", () => {
    expect(parseDate("whenever")).toBeNull();
  });
});

describe("headers", () => {
  it("names every column the template asks for", () => {
    expect(DU_APR_HEADERS).toContain("Agent");
    expect(DU_APR_HEADERS).toContain("Utilization_Pct");
  });
});
