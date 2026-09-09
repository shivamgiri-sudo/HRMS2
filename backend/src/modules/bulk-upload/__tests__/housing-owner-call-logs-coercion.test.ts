import { describe, it, expect } from "vitest";
import {
  parseCount, parseNullableCount, parseDurationSeconds, parseDate, HOUSING_OWNER_CALL_LOGS_HEADERS,
} from "../housing-owner-call-logs-bulk.service.js";

describe("parseCount", () => {
  it("treats a blank as zero", () => {
    expect(parseCount("")).toBe(0);
  });
  it("reads a real count", () => {
    expect(parseCount("443")).toBe(443);
  });
});

describe("parseNullableCount", () => {
  it("keeps a blank null", () => {
    expect(parseNullableCount("")).toBeNull();
  });
  it("reads zero as zero, not null", () => {
    expect(parseNullableCount("0")).toBe(0);
  });
});

/** Durations in the real sample are HH:MM:SS text, e.g. "01:27:44". */
describe("parseDurationSeconds", () => {
  it("reads a real HH:MM:SS duration from the sample (01:27:44 = 5264s)", () => {
    expect(parseDurationSeconds("01:27:44")).toBe(5264);
  });
  it("reads a full-day duration (24:00:00 = 86400s)", () => {
    expect(parseDurationSeconds("24:00:00")).toBe(86400);
  });
  it("reads MM:SS", () => {
    expect(parseDurationSeconds("05:30")).toBe(330);
  });
  it("returns null for blank", () => {
    expect(parseDurationSeconds("")).toBeNull();
  });
});

describe("parseDate", () => {
  it("reads a real date string from the sample", () => {
    expect(parseDate("2026-09-01")).toBe("2026-09-01");
  });
});

describe("headers", () => {
  it("names every column the template asks for", () => {
    expect(HOUSING_OWNER_CALL_LOGS_HEADERS).toContain("Total_Calls");
    expect(HOUSING_OWNER_CALL_LOGS_HEADERS).toContain("Break_Duration");
  });
});
