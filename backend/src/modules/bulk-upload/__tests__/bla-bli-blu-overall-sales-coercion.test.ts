import { describe, it, expect } from "vitest";
import {
  parseDate, parseDateTime, parseCallDurationSeconds, parseNullableInt,
  parseNullableDecimal, cleanText, BLA_BLI_BLU_OVERALL_SALES_HEADERS,
} from "../bla-bli-blu-overall-sales-bulk.service.js";

describe("parseDate", () => {
  it("reads the real plain Date Excel serial from the sample (46235 = 2026-08-01)", () => {
    expect(parseDate(46235)).toBe("2026-08-01");
  });
  it("returns null for blank", () => {
    expect(parseDate("")).toBeNull();
  });
});

/** Order Creation time/Call Date & Time are FRACTIONAL Excel serials (date + time-of-day). */
describe("parseDateTime", () => {
  it("reads the real fractional Order Creation time serial from the sample (46235.736909722225 = 2026-08-01 17:41:09)", () => {
    expect(parseDateTime(46235.736909722225)).toBe("2026-08-01 17:41:09");
  });
  it("returns null for blank", () => {
    expect(parseDateTime("")).toBeNull();
  });
});

/** A call never lasts a whole day, so this fraction-of-a-day column is unambiguous by construction. */
describe("parseCallDurationSeconds", () => {
  it("converts the real fraction-of-a-day sample (0.006018518518518518 = 520 seconds)", () => {
    expect(parseCallDurationSeconds(0.006018518518518518)).toBe(520);
  });
  it("returns null for blank", () => {
    expect(parseCallDurationSeconds("")).toBeNull();
  });
});

describe("parseNullableInt / parseNullableDecimal", () => {
  it("parses real Countifs of calls / Amount samples", () => {
    expect(parseNullableInt(5)).toBe(5);
    expect(parseNullableDecimal(1041)).toBe(1041);
  });
  it("returns null for blank, not zero", () => {
    expect(parseNullableInt("")).toBeNull();
    expect(parseNullableDecimal(null)).toBeNull();
  });
});

describe("cleanText", () => {
  it("trims and returns null for blank", () => {
    expect(cleanText("  ARUN JOSHI  ")).toBe("ARUN JOSHI");
    expect(cleanText("")).toBeNull();
    expect(cleanText(undefined)).toBeNull();
  });
});

describe("headers", () => {
  it("names OrderID, the row's identity column", () => {
    expect(BLA_BLI_BLU_OVERALL_SALES_HEADERS).toContain("OrderID");
    expect(BLA_BLI_BLU_OVERALL_SALES_HEADERS).toContain("Date");
  });
});
