import { describe, it, expect } from "vitest";
import {
  parseNullableSeconds, parseNullableInt, parseDate, parseEndTime,
  HOUSING_PREMIUM_CDR_HEADERS,
} from "../housing-premium-cdr-bulk.service.js";

/** DURATION/Talk_Duration/Ringing_Duration arrive as plain seconds already in the real sample. */
describe("parseNullableSeconds", () => {
  it("reads a real plain-seconds duration from the sample", () => {
    expect(parseNullableSeconds(4)).toBe(4);
    expect(parseNullableSeconds(0)).toBe(0);
  });
  it("returns null for blank", () => {
    expect(parseNullableSeconds("")).toBeNull();
  });
});

describe("parseDate", () => {
  it("reads the real plain Excel serial from the sample (46235 = 2026-08-01)", () => {
    expect(parseDate(46235)).toBe("2026-08-01");
  });
});

/** End_Time is a FRACTIONAL serial (date + time-of-day), floored per this session's clovia CRM convention. */
describe("parseEndTime", () => {
  it("reads the real fractional End_Time serial from the sample (46235.81636574074 = 2026-08-01 19:35:34)", () => {
    expect(parseEndTime(46235.81636574074)).toBe("2026-08-01 19:35:34");
  });
  it("still reads a plain date+time text string", () => {
    expect(parseEndTime("2026-08-01 19:35:34")).toBe("2026-08-01 19:35:34");
  });
  it("returns null for blank", () => {
    expect(parseEndTime("")).toBeNull();
  });
});

describe("parseNullableInt", () => {
  it("reads a real Date_Row_Count value", () => {
    expect(parseNullableInt("402")).toBe(402);
  });
});

describe("headers", () => {
  it("names every column the template asks for", () => {
    expect(HOUSING_PREMIUM_CDR_HEADERS).toContain("Date_Row_Count");
    expect(HOUSING_PREMIUM_CDR_HEADERS).toContain("End_Time");
  });
});
