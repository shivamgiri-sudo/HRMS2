import { describe, it, expect } from "vitest";
import {
  parseNullableAmount, parseNullableInt, parseDurationSeconds, parseDate, parseDateTime,
  LP_CDR_HEADERS, LP_CR_REPORT_HEADERS,
} from "../lp-cdr-cr-report-bulk.service.js";

describe("parseDurationSeconds", () => {
  it("reads the real HH:MM:SS duration from the CDR sample (00:01:42 = 102s)", () => {
    expect(parseDurationSeconds("00:01:42")).toBe(102);
  });
  it("reads a longer real duration (00:15:02 = 902s)", () => {
    expect(parseDurationSeconds("00:15:02")).toBe(902);
  });
  it("returns null for blank", () => {
    expect(parseDurationSeconds("")).toBeNull();
  });
});

describe("parseDate", () => {
  it("reads the real 'DD Mon YYYY' Date column format", () => {
    expect(parseDate("01 Jul 2026")).toBe("2026-07-01");
  });
  it("reads a normal ISO date string", () => {
    expect(parseDate("2026-09-08")).toBe("2026-09-08");
  });
});

/** "Disconnected Time" arrives as "01 Jul 2026 17:43" -- date AND time in one field. */
describe("parseDateTime", () => {
  it("reads the real sample's date+time text", () => {
    expect(parseDateTime("01 Jul 2026 17:43")).toBe("2026-07-01 17:43:00");
  });
  it("reads a later real sample value", () => {
    expect(parseDateTime("10 Jul 2026 11:28")).toBe("2026-07-10 11:28:00");
  });
  it("returns null for blank or unrecognised text", () => {
    expect(parseDateTime("")).toBeNull();
    expect(parseDateTime("garbage")).toBeNull();
  });
});

describe("parseNullableAmount / parseNullableInt", () => {
  it("keeps a blank null rather than zero", () => {
    expect(parseNullableAmount("")).toBeNull();
    expect(parseNullableInt("")).toBeNull();
  });
  it("reads real values from the samples", () => {
    expect(parseNullableAmount("256249")).toBe(256249);
    expect(parseNullableInt("5")).toBe(5);
  });
});

describe("headers", () => {
  it("names every column both templates ask for", () => {
    expect(LP_CDR_HEADERS).toContain("Ticket_Ref");
    expect(LP_CDR_HEADERS).toContain("Unique");
    expect(LP_CR_REPORT_HEADERS).toContain("Mobile");
    expect(LP_CR_REPORT_HEADERS).toContain("CreatedOn");
  });
});
