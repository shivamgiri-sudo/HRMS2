import { describe, it, expect } from "vitest";
import {
  parseDate, parseDateTime, parseSecondsFlexible, parseNullableInt, parseBoolFlag, cleanText,
  DALMIA_IB_CDR_HEADERS,
} from "../dalmia-ib-cdr-bulk.service.js";

describe("parseDate", () => {
  it("reads an ISO date string", () => {
    expect(parseDate("2026-07-01")).toBe("2026-07-01");
  });
});

describe("parseDateTime", () => {
  it("reads an ISO datetime string (the real CallTime sample)", () => {
    expect(parseDateTime("2026-07-01 10:12:11")).toBe("2026-07-01 10:12:11");
  });
  it("returns null for blank", () => {
    expect(parseDateTime("")).toBeNull();
  });
});

/** Duration cells arrive as "HH:MM:SS" strings once normalized from Excel time-of-day cells. */
describe("parseSecondsFlexible", () => {
  it("parses the real Callduration sample (00:00:55 = 55 seconds)", () => {
    expect(parseSecondsFlexible("00:00:55")).toBe(55);
  });
  it("still accepts a day-fraction decimal, cutoff at 1 not 3", () => {
    expect(parseSecondsFlexible(3)).toBe(3);
  });
});

describe("parseNullableInt / parseBoolFlag / cleanText", () => {
  it("parses the real Count sample", () => {
    expect(parseNullableInt(2)).toBe(2);
    expect(parseNullableInt("")).toBeNull();
  });
  it("normalises the real Short Calls 0/1 flag", () => {
    expect(parseBoolFlag(1)).toBe(1);
    expect(parseBoolFlag(0)).toBe(0);
    expect(parseBoolFlag("")).toBeNull();
  });
  it("trims and nulls blank", () => {
    expect(cleanText(" MAS62620 ")).toBe("MAS62620");
    expect(cleanText("")).toBeNull();
  });
});

describe("headers", () => {
  it("names Agent Id and CallTime, part of this row's identity", () => {
    expect(DALMIA_IB_CDR_HEADERS).toContain("Agent Id");
    expect(DALMIA_IB_CDR_HEADERS).toContain("CallTime");
  });
});
