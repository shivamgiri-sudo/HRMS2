import { describe, it, expect } from "vitest";
import {
  parseCount, parseDate, CLOVIA_CHAT_DAILY_HEADERS,
} from "../clovia-chat-daily-bulk.service.js";

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

/** Same epoch convention as clovia-email-daily-bulk.service.ts, confirmed against the same live workbook family. */
describe("parseDate", () => {
  it("reads a real Excel serial from the live workbook (46266 = 2026-09-01)", () => {
    expect(parseDate(46266)).toBe("2026-09-01");
  });
  it("still reads a normal date string, for a sheet already reformatted", () => {
    expect(parseDate("2026-09-08")).toBe("2026-09-08");
  });
  it("refuses anything else rather than inventing a date", () => {
    expect(parseDate("last Tuesday")).toBeNull();
    expect(parseDate("")).toBeNull();
  });
});

describe("headers", () => {
  it("names every column the template asks for", () => {
    expect(CLOVIA_CHAT_DAILY_HEADERS).toHaveLength(4);
    expect(CLOVIA_CHAT_DAILY_HEADERS).toContain("C-Sat Count");
    // Response%/Chat-CSAT% are deliberately never accepted -- derivable from raw counts.
    expect(CLOVIA_CHAT_DAILY_HEADERS as readonly string[]).not.toContain("Response%");
  });
});
