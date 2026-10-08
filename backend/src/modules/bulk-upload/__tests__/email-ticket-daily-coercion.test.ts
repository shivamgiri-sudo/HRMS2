import { describe, it, expect } from "vitest";
import {
  parseDashboardLabel, parseCount, parseOpeningPending, parseDate, EMAIL_TICKET_DAILY_HEADERS,
} from "../email-ticket-daily-bulk.service.js";

describe("parseDashboardLabel", () => {
  it("accepts either dashboard's full or short name, case-insensitively", () => {
    expect(parseDashboardLabel("Molecular Email")).toBe("MOLECULAR");
    expect(parseDashboardLabel("molecular")).toBe("MOLECULAR");
    expect(parseDashboardLabel("Reginald Men Email")).toBe("REGINALD_MEN");
    expect(parseDashboardLabel("reginald")).toBe("REGINALD_MEN");
  });
  it("refuses anything unrecognised rather than guessing", () => {
    expect(parseDashboardLabel("Bella Vita")).toBeNull();
    expect(parseDashboardLabel("")).toBeNull();
  });
});

/** total_tickets/email_closed/open_pending/email_reopen are NOT NULL with a 0 default. */
describe("parseCount", () => {
  it("treats a blank as zero", () => {
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

/** opening_pending is nullable: "not supplied" must not silently become zero and skew closure %. */
describe("parseOpeningPending", () => {
  it("keeps a blank null rather than treating it as zero backlog", () => {
    expect(parseOpeningPending("")).toBeNull();
    expect(parseOpeningPending("n/a")).toBeNull();
  });
  it("reads a real count", () => {
    expect(parseOpeningPending("58")).toBe(58);
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
    expect(EMAIL_TICKET_DAILY_HEADERS).toHaveLength(7);
    expect(EMAIL_TICKET_DAILY_HEADERS[0]).toBe("Dashboard");
    expect(EMAIL_TICKET_DAILY_HEADERS).toContain("Opening Pending");
  });
});
