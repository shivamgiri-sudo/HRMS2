import { describe, expect, it } from "vitest";
import {
  BPO_MASTER_REPORTS,
  assertBpoMasterReportCatalog,
} from "../bpo-master-report-catalog.js";

const EXPECTED_CODES = [
  "bpo-operations-productivity-master",
  "bpo-employee-performance-360-master",
  "bpo-client-sla-delivery-master",
  "bpo-wfm-attendance-shrinkage-master",
  "bpo-hr-workforce-lifecycle-master",
  "bpo-payroll-statutory-master",
  "bpo-finance-pnl-profitability-master",
  "bpo-quality-risk-compliance-master",
  "bpo-recruitment-training-readiness-master",
  "bpo-admin-asset-facility-master",
  "bpo-management-executive-master",
];

describe("BPO master report catalog", () => {
  it("contains the complete limited set of comprehensive BPO master reports", () => {
    expect(BPO_MASTER_REPORTS).toHaveLength(11);
    expect(BPO_MASTER_REPORTS.map((report) => report.code).sort()).toEqual(EXPECTED_CODES.sort());
  });

  it("passes the runtime catalog assertion", () => {
    expect(() => assertBpoMasterReportCatalog()).not.toThrow();
  });

  it("requires employee code and report date in every report", () => {
    for (const report of BPO_MASTER_REPORTS) {
      expect(report.employeeCodePolicy).toBe("MANDATORY");
      expect(report.dateStandard).toBe("DD-MMM-YYYY");
      expect(report.columns.some((column) => column.key === "EMPLOYEE_CODE")).toBe(true);
      expect(report.columns.some((column) => column.key === "REPORT_DATE")).toBe(true);
    }
  });

  it("uses uppercase, unique headers only", () => {
    for (const report of BPO_MASTER_REPORTS) {
      const keys = report.columns.map((column) => column.key);
      const labels = report.columns.map((column) => column.label);
      expect(new Set(keys).size).toBe(keys.length);
      expect(new Set(labels).size).toBe(labels.length);
      for (const column of report.columns) {
        expect(column.key).toBe(column.key.toUpperCase());
        expect(column.label).toBe(column.label.toUpperCase());
        expect(column.key).toMatch(/^[A-Z0-9_]+$/);
      }
    }
  });

  it("keeps every report deep rather than creating shallow split reports", () => {
    for (const report of BPO_MASTER_REPORTS) {
      expect(report.columns.length).toBeGreaterThanOrEqual(45);
      expect(report.sourceDomains.length).toBeGreaterThanOrEqual(7);
      expect(report.controlNotes.length).toBeGreaterThanOrEqual(3);
      expect(report.primaryKey.length).toBeGreaterThanOrEqual(2);
      expect(report.rowGrain).toContain("ONE ROW PER");
    }
  });

  it("marks aggregate reports explicitly instead of inventing employee codes", () => {
    const aggregateCodes = [
      "bpo-client-sla-delivery-master",
      "bpo-finance-pnl-profitability-master",
      "bpo-management-executive-master",
    ];
    for (const code of aggregateCodes) {
      const report = BPO_MASTER_REPORTS.find((item) => item.code === code);
      expect(report?.aggregateEmployeeCode).toBe("AGGREGATE");
    }
  });

  it("protects sensitive HR, payroll, finance and compliance data", () => {
    const sensitiveDomains = [
      "bpo-hr-workforce-lifecycle-master",
      "bpo-payroll-statutory-master",
      "bpo-finance-pnl-profitability-master",
      "bpo-quality-risk-compliance-master",
      "bpo-recruitment-training-readiness-master",
      "bpo-admin-asset-facility-master",
    ];
    for (const code of sensitiveDomains) {
      const report = BPO_MASTER_REPORTS.find((item) => item.code === code);
      expect(report?.columns.some((column) => column.sensitive)).toBe(true);
      expect(report?.exportRoles.length).toBeGreaterThan(0);
    }
  });
});
