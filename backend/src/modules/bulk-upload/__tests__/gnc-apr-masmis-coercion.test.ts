import { describe, it, expect } from "vitest";
import { parseReportDate, GNC_APR_MASMIS_HEADERS } from "../gnc-apr-masmis-bulk.service.js";

describe("parseReportDate", () => {
  it("reads a real ISO sample", () => {
    expect(parseReportDate("2026-05-30")).toBe("2026-05-30");
  });
  it("reads a real M/D/YYYY sample", () => {
    expect(parseReportDate("5/30/2026")).toBe("2026-05-30");
  });
  it("returns null for blank", () => {
    expect(parseReportDate("")).toBeNull();
  });
});

describe("headers", () => {
  it("names user_name and report_date, the row's required fields", () => {
    expect(GNC_APR_MASMIS_HEADERS).toContain("user_name");
    expect(GNC_APR_MASMIS_HEADERS).toContain("report_date");
  });
  it("covers the real live table's full duration-column set, not just the retired subset", () => {
    for (const col of ["aoc", "bio", "bre", "briefing", "down_time", "lunch", "meet", "qa", "sb",
      "tea_break", "training_break", "wash", "tra_qa", "downtime", "capping", "login_duration", "logout_time"]) {
      expect(GNC_APR_MASMIS_HEADERS).toContain(col);
    }
  });
});
