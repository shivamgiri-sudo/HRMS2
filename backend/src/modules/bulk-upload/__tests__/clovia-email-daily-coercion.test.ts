import { describe, it, expect } from "vitest";
import {
  parseCount, parseDate, CLOVIA_EMAIL_DAILY_HEADERS,
} from "../clovia-email-daily-bulk.service.js";

describe("parseCount", () => {
  it("treats a blank as zero, because the column is NOT NULL with a 0 default", () => {
    expect(parseCount("")).toBe(0);
    expect(parseCount(null)).toBe(0);
  });
  it("reads Indian-formatted thousands", () => {
    expect(parseCount("1,234")).toBe(1234);
  });
  it("does not let junk or a negative become a silent wrong count", () => {
    expect(parseCount("n/a")).toBe(0);
    expect(parseCount("-5")).toBe(0);
  });
});

/**
 * The live source file (Clovia Email Tracker Sept'26.xlsb) stores Date as an
 * Excel serial number, not text -- confirmed by reading the real workbook.
 */
describe("parseDate", () => {
  it("reads a real Excel serial from the live workbook (46266 = 2026-09-01)", () => {
    expect(parseDate(46266)).toBe("2026-09-01");
    expect(parseDate(46267)).toBe("2026-09-02");
  });
  it("also accepts a bare numeric string, in case a sheet exports it as text", () => {
    expect(parseDate("46266")).toBe("2026-09-01");
  });
  it("still reads a normal date string, for a sheet already reformatted", () => {
    expect(parseDate("2026-09-08")).toBe("2026-09-08");
    expect(parseDate("8-Sep-2026")).toBe("2026-09-08");
    expect(parseDate("9/8/2026")).toBe("2026-09-08");
  });
  it("refuses anything else rather than inventing a date", () => {
    expect(parseDate("last Tuesday")).toBeNull();
    expect(parseDate("")).toBeNull();
  });
});

describe("headers", () => {
  it("names every column exactly as the live workbook has them", () => {
    expect(CLOVIA_EMAIL_DAILY_HEADERS).toHaveLength(10);
    expect(CLOVIA_EMAIL_DAILY_HEADERS[2]).toBe("AgentName");
    expect(CLOVIA_EMAIL_DAILY_HEADERS).toContain("Re-Open");
    expect(CLOVIA_EMAIL_DAILY_HEADERS).toContain("JunkMail");
  });
});
