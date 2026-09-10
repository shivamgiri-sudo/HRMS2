import { describe, it, expect } from "vitest";
import { parseReportDate, BB_APR_HEADERS } from "../bb-apr-masmis-bulk.service.js";

describe("parseReportDate", () => {
  it("reads a real ISO sample", () => {
    expect(parseReportDate("2026-06-29")).toBe("2026-06-29");
  });
  it("reads a real M/D/YYYY sample", () => {
    expect(parseReportDate("6/29/2026")).toBe("2026-06-29");
  });
  it("returns null for blank", () => {
    expect(parseReportDate("")).toBeNull();
  });
});

describe("headers", () => {
  it("names emp_name and report_date, the row's required fields", () => {
    expect(BB_APR_HEADERS).toContain("emp_name");
    expect(BB_APR_HEADERS).toContain("report_date");
  });
});
