import { describe, it, expect } from "vitest";
import {
  parseCallCount, parseDurationSeconds, parseDate, LP_APR_DAILY_HEADERS,
} from "../lp-apr-daily-bulk.service.js";

describe("parseCallCount", () => {
  it("treats a blank as zero, because the column is NOT NULL with a 0 default", () => {
    expect(parseCallCount("")).toBe(0);
    expect(parseCallCount(null)).toBe(0);
  });
  it("reads Indian-formatted thousands", () => {
    expect(parseCallCount("1,234")).toBe(1234);
  });
  it("does not let junk or a negative become a silent wrong count", () => {
    expect(parseCallCount("n/a")).toBe(0);
    expect(parseCallCount("-5")).toBe(0);
  });
});

/**
 * The SOP's own instruction is "Convert text to numbers" on every duration
 * column -- the raw WebConsole export is HH:MM:SS text.
 */
describe("parseDurationSeconds", () => {
  it("reads HH:MM:SS", () => {
    expect(parseDurationSeconds("08:12:30")).toBe(8 * 3600 + 12 * 60 + 30);
  });
  it("reads MM:SS when a duration is under an hour", () => {
    expect(parseDurationSeconds("27:20")).toBe(27 * 60 + 20);
  });
  it("accepts a sheet already converted to a bare seconds count", () => {
    expect(parseDurationSeconds("4200")).toBe(4200);
  });
  it("treats a blank as zero, because these columns are NOT NULL with a 0 default", () => {
    expect(parseDurationSeconds("")).toBe(0);
    expect(parseDurationSeconds(null)).toBe(0);
  });
});

describe("parseDate", () => {
  it("reads the formats these sheets mix", () => {
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
  it("names every column the template asks for", () => {
    expect(LP_APR_DAILY_HEADERS).toHaveLength(9);
    expect(LP_APR_DAILY_HEADERS[0]).toBe("Agent");
    expect(LP_APR_DAILY_HEADERS).toContain("Wrapup Duration");
    // LoginId is explicitly deleted by the SOP before pasting -- never a column here.
    expect(LP_APR_DAILY_HEADERS as readonly string[]).not.toContain("LoginId");
  });
});
