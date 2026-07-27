import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BPO_MASTER_REPORTS } from "../bpo-master-report-registry.js";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("report export format contracts", () => {
  it("all column headers are uppercase in every master report", () => {
    for (const report of BPO_MASTER_REPORTS) {
      for (const col of report.columns) {
        expect(col.key, `${report.code}: key ${col.key} not uppercase`).toBe(col.key.toUpperCase());
        expect(col.label, `${report.code}: label ${col.label} not uppercase`).toBe(col.label.toUpperCase());
      }
    }
  });

  it("EMPLOYEE_CODE is present in every report", () => {
    for (const report of BPO_MASTER_REPORTS) {
      const hasEmpCode = report.columns.some((c) => c.key === "EMPLOYEE_CODE");
      expect(hasEmpCode, `${report.code} missing EMPLOYEE_CODE`).toBe(true);
    }
  });

  it("REPORT_DATE is present in every report", () => {
    for (const report of BPO_MASTER_REPORTS) {
      const hasReportDate = report.columns.some((c) => c.key === "REPORT_DATE");
      expect(hasReportDate, `${report.code} missing REPORT_DATE`).toBe(true);
    }
  });

  it("date standard is DD-MMM-YYYY in all reports", () => {
    for (const report of BPO_MASTER_REPORTS) {
      expect(report.dateStandard).toBe("DD-MMM-YYYY");
    }
  });

  it("v2 service applies date formatting", () => {
    const svc = source("../bpo-master-report-v2.service.ts");
    expect(svc).toMatch(/DATE_FORMAT|%d-%b-%Y|DD-MMM-YYYY/);
  });

  it("export route enforces export role check", () => {
    const routes = source("../bpo-master-report.routes.ts");
    expect(routes).toContain("exportRoles");
  });
});
