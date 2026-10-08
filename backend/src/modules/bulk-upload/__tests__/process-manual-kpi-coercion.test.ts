import { describe, it, expect } from "vitest";
import { parseNumber, parseDate, PROCESS_MANUAL_KPI_HEADERS } from "../process-manual-kpi-bulk.service.js";

describe("parseNumber", () => {
  it("reads Indian-formatted thousands", () => {
    expect(parseNumber("1,23,456")).toBe(123456);
    expect(parseNumber("60000")).toBe(60000);
  });
  it("returns null for a blank or unusable cell, distinct from zero", () => {
    expect(parseNumber("")).toBeNull();
    expect(parseNumber(null)).toBeNull();
    expect(parseNumber("n/a")).toBeNull();
  });
  it("reads an explicit zero as zero, not as blank", () => {
    expect(parseNumber("0")).toBe(0);
  });
});

describe("parseDate", () => {
  it("reads the formats a manual sheet mixes", () => {
    expect(parseDate("2026-09-08")).toBe("2026-09-08");
    expect(parseDate("8-Sep-2026")).toBe("2026-09-08");
    expect(parseDate("9/8/2026")).toBe("2026-09-08");
  });
  it("refuses anything unreadable rather than guessing", () => {
    expect(parseDate("today")).toBeNull();
    expect(parseDate("")).toBeNull();
  });
});

describe("headers", () => {
  it("names Process Code and Date plus every metric column the linked sources read", () => {
    expect(PROCESS_MANUAL_KPI_HEADERS[0]).toBe("Process Code");
    expect(PROCESS_MANUAL_KPI_HEADERS[1]).toBe("Date");
    expect(PROCESS_MANUAL_KPI_HEADERS).toContain("Sales");
    expect(PROCESS_MANUAL_KPI_HEADERS).toContain("Revenue");
    expect(PROCESS_MANUAL_KPI_HEADERS).toContain("Connected");
    expect(PROCESS_MANUAL_KPI_HEADERS).toContain("Allocated");
  });

  /**
   * These four exist for IDAM Natural Wellness's chat KPIs (CHAT_TICKETS,
   * CHAT_RESOLVED_PCT, CHAT_FRT_SLA_PCT), whose real source — db_masmis.bb_chat —
   * is the same stopped-upload problem as the sales tables: verified stale 71
   * days on 2026-09-08, despite the table name suggesting Bella Vita.
   */
  it("names the chat columns added for IDAM's manual feed", () => {
    expect(PROCESS_MANUAL_KPI_HEADERS).toContain("Tickets");
    expect(PROCESS_MANUAL_KPI_HEADERS).toContain("Resolved");
    expect(PROCESS_MANUAL_KPI_HEADERS).toContain("In TAT");
    expect(PROCESS_MANUAL_KPI_HEADERS).toContain("Judged");
  });
});
