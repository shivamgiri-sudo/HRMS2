import { describe, it, expect } from "vitest";
import {
  canonicalizeRow, parseFlexibleDateTime, parseFlexibleDate, parseClockTime, parseDurationSeconds, parsePercent, cleanPhone,
  isScientificNotation,
} from "../dalmia-import-helpers.js";
import { splitAttendance } from "../dalmia-apr-bulk.service.js";
import { DALMIA_AFTER_HOUR_HEADERS } from "../dalmia-after-hour-bulk.service.js";

// Every input below is read off the real sheets the business supplied (text as Excel displays it).
describe("parseFlexibleDateTime / parseFlexibleDate", () => {
  it("reads the dial-desk CallDate '7/1/2026 10:12' as 1 July (month/day)", () => {
    expect(parseFlexibleDateTime("7/1/2026 10:12")).toBe("2026-07-01 10:12:00");
  });
  it("reads the outbound Date '31-08-2026 21:27:02' as day-month-year", () => {
    expect(parseFlexibleDateTime("31-08-2026 21:27:02")).toBe("2026-08-31 21:27:02");
  });
  it("reads the outbound Calling Date '9/2/2026' as 2 September", () => {
    expect(parseFlexibleDate("9/2/2026")).toBe("2026-09-02");
  });
  it("reads the after-hour Date '9/1/2026 19:03'", () => {
    expect(parseFlexibleDateTime("9/1/2026 19:03")).toBe("2026-09-01 19:03:00");
  });
  it("reads the APR Date '1-Aug-26' and '1-Sep-26'", () => {
    expect(parseFlexibleDate("1-Aug-26")).toBe("2026-08-01");
    expect(parseFlexibleDate("1-Sep-26")).toBe("2026-09-01");
  });
  it("still reads ISO text and Excel serials (with a time fraction)", () => {
    expect(parseFlexibleDateTime("2026-07-01 10:12:47")).toBe("2026-07-01 10:12:47");
    expect(parseFlexibleDate("2026-07-03")).toBe("2026-07-03");
    expect(parseFlexibleDateTime(46204.5)).toBe("2026-07-01 12:00:00");
    expect(parseFlexibleDate("46204")).toBe("2026-07-01");
  });
  it("uses the only valid reading when one part exceeds 12", () => {
    expect(parseFlexibleDate("25/12/2026")).toBe("2026-12-25"); // slash, first > 12 -> day/month
    expect(parseFlexibleDate("12-25-2026")).toBe("2026-12-25"); // dash, second > 12 -> month-day
  });
  it("returns null for blanks and nonsense, never a made-up date", () => {
    expect(parseFlexibleDateTime("")).toBeNull();
    expect(parseFlexibleDateTime("not a date")).toBeNull();
    expect(parseFlexibleDate("31/02/2026")).toBeNull();
  });
});

describe("durations, clock times and percentages (APR sheet)", () => {
  it("converts h:mm:ss durations to seconds", () => {
    expect(parseDurationSeconds("7:46:42")).toBe(28002);
    expect(parseDurationSeconds("0:20:55")).toBe(1255);
    expect(parseDurationSeconds("0:00:00")).toBe(0);
  });
  it("accepts plain seconds and treats blank as null (not zero)", () => {
    expect(parseDurationSeconds("162")).toBe(162);
    expect(parseDurationSeconds("")).toBeNull();
  });
  it("reads Login / Logout clock times", () => {
    expect(parseClockTime("9:32:52")).toBe("09:32:52");
    expect(parseClockTime("19:01:07")).toBe("19:01:07");
    expect(parseClockTime("")).toBeNull();
  });
  it("reads Utilization '43%' as 43", () => {
    expect(parsePercent("43%")).toBe(43);
    expect(parsePercent("0.43")).toBe(43);
  });
  it("splits the sheet's two Attendance columns (day count, then P/A status)", () => {
    expect(splitAttendance("1.00", "P")).toEqual({ days: 1, status: "P" });
    expect(splitAttendance("P", "1.00")).toEqual({ days: 1, status: "P" });
    expect(splitAttendance("", "")).toEqual({ days: null, status: null });
  });
});

describe("after-hour contact number", () => {
  it("falls back to 'Number' when 'Contact No' was rounded to scientific notation", () => {
    expect(isScientificNotation("9.18235E+11")).toBe(true);
    expect(cleanPhone("9.18235E+11", "8235045129")).toBe("8235045129");
    expect(cleanPhone("7636891735", "7636891735")).toBe("7636891735");
  });
  it("is null when neither column holds real digits", () => {
    expect(cleanPhone("9.19382E+11", "")).toBeNull();
  });
  it("lists 'Number' as a recognised header", () => {
    expect(DALMIA_AFTER_HOUR_HEADERS).toContain("Number");
  });
});

describe("canonicalizeRow", () => {
  it("matches headers case/space/punctuation-insensitively and keeps extra columns", () => {
    const out = canonicalizeRow({ "call id": "158792", "CALLDATE": "7/1/2026 10:12", "e-mail id": "a@b.c", Extra: "x" }, ["Call Id", "CallDate", "E-Mail ID"]);
    expect(out["Call Id"]).toBe("158792");
    expect(out["CallDate"]).toBe("7/1/2026 10:12");
    expect(out["E-Mail ID"]).toBe("a@b.c");
    expect(out["Extra"]).toBe("x");
  });
});
