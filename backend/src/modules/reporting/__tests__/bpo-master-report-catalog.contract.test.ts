import { describe, expect, it } from "vitest";
import {
  BPO_MASTER_REPORTS,
  assertBpoMasterReportRegistry,
} from "../bpo-master-report-registry.js";

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
  "bpo-audit-compliance-control-master",
  "bpo-interview-to-exit-journey-ledger",
  "bpo-report-data-lineage-reconciliation-master",
];

const GOVERNED_ADAPTER_CODES = [...EXPECTED_CODES];

const GOVERNANCE_CODES = [
  "bpo-audit-compliance-control-master",
  "bpo-interview-to-exit-journey-ledger",
  "bpo-report-data-lineage-reconciliation-master",
];

describe("BPO master report registry", () => {
  it("contains the complete comprehensive BPO master report set", () => {
    expect(BPO_MASTER_REPORTS).toHaveLength(14);
    expect(BPO_MASTER_REPORTS.map((report) => report.code).sort()).toEqual(EXPECTED_CODES.sort());
  });

  it("passes the combined runtime registry assertion", () => {
    expect(() => assertBpoMasterReportRegistry()).not.toThrow();
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
      "bpo-audit-compliance-control-master",
      "bpo-report-data-lineage-reconciliation-master",
    ];
    for (const code of aggregateCodes) {
      const report = BPO_MASTER_REPORTS.find((item) => item.code === code);
      expect(report?.aggregateEmployeeCode).toBe("AGGREGATE");
    }
  });

  it("protects sensitive HR, payroll, finance, candidate, audit and compliance data", () => {
    const sensitiveDomains = [
      "bpo-hr-workforce-lifecycle-master",
      "bpo-payroll-statutory-master",
      "bpo-finance-pnl-profitability-master",
      "bpo-quality-risk-compliance-master",
      "bpo-recruitment-training-readiness-master",
      "bpo-admin-asset-facility-master",
      "bpo-audit-compliance-control-master",
      "bpo-interview-to-exit-journey-ledger",
    ];
    for (const code of sensitiveDomains) {
      const report = BPO_MASTER_REPORTS.find((item) => item.code === code);
      expect(report?.columns.some((column) => column.sensitive)).toBe(true);
      expect(report?.exportRoles.length).toBeGreaterThan(0);
    }
  });

  it("does not expose management-grade master reports to the general employee role", () => {
    for (const report of BPO_MASTER_REPORTS) {
      expect(report.viewRoles).not.toContain("employee");
      expect(report.exportRoles).not.toContain("employee");
    }
  });

  it("has a governed adapter path for every master report", () => {
    expect(GOVERNED_ADAPTER_CODES).toHaveLength(14);
    for (const code of GOVERNED_ADAPTER_CODES) expect(EXPECTED_CODES).toContain(code);
  });

  it("adds audit, complete journey and data-lineage control ledgers", () => {
    for (const code of GOVERNANCE_CODES) {
      const report = BPO_MASTER_REPORTS.find((item) => item.code === code);
      expect(report).toBeDefined();
      expect(report?.controlNotes.some((note) => /source|record|lineage|accuracy/i.test(note))).toBe(true);
    }
  });

  it("journey ledger includes required event tracking columns", () => {
    const journeyReport = BPO_MASTER_REPORTS.find(
      (r) => r.code === "bpo-interview-to-exit-journey-ledger"
    )!;
    const keys = journeyReport.columns.map((c) => c.key);
    expect(keys).toContain("ACTIVITY_DATE_TIME");
    expect(keys).toContain("PREVIOUS_STAGE");
    expect(keys).toContain("NEW_STAGE");
    expect(keys).toContain("SOURCE_RECORD_ID");
    expect(keys).toContain("ACTOR_EMPLOYEE_CODE");
    expect(keys).toContain("APPROVER_EMPLOYEE_CODE");
    expect(keys).toContain("SOURCE_TABLE");
    expect(keys).toContain("JOURNEY_PHASE");
    expect(keys).toContain("JOURNEY_STAGE");
  });

  it("audit compliance master includes required control evidence fields", () => {
    const auditReport = BPO_MASTER_REPORTS.find(
      (r) => r.code === "bpo-audit-compliance-control-master"
    )!;
    const keys = auditReport.columns.map((c) => c.key);
    expect(keys).toContain("CONTROL_RESULT");
    expect(keys).toContain("ACTOR_EMPLOYEE_CODE");
    expect(keys).toContain("SUBJECT_EMPLOYEE_CODE");
    expect(keys).toContain("OLD_VALUE");
    expect(keys).toContain("NEW_VALUE");
    expect(keys).toContain("DPDP_PURPOSE");
    expect(keys).toContain("DATA_CLASSIFICATION");
    expect(keys).toContain("EXCEPTION_FLAG");
    expect(keys).toContain("CORRECTIVE_ACTION");
    expect(keys).toContain("SLA_STATUS");
  });

  it("payroll master includes payroll run reconciliation fields", () => {
    const payrollReport = BPO_MASTER_REPORTS.find(
      (r) => r.code === "bpo-payroll-statutory-master"
    )!;
    const keys = payrollReport.columns.map((c) => c.key);
    expect(keys).toContain("PAYROLL_RUN_ID");
    expect(keys).toContain("PAYROLL_MONTH");
    expect(keys).toContain("GROSS_EARNINGS");
    expect(keys).toContain("NET_PAY");
    expect(keys).toContain("BASIC_PAY");
  });

  it("finance master keeps planned and earned revenue as distinct columns", () => {
    const financeReport = BPO_MASTER_REPORTS.find(
      (r) => r.code === "bpo-finance-pnl-profitability-master"
    )!;
    const keys = financeReport.columns.map((c) => c.key);
    expect(keys).toContain("PLANNED_REVENUE");
    expect(keys).toContain("EARNED_REVENUE");
    expect(keys).toContain("PAYROLL_COST");
    expect(keys).toContain("EBITDA");
  });

  it("WFM master separates roster date from payroll attendance input", () => {
    const wfmReport = BPO_MASTER_REPORTS.find(
      (r) => r.code === "bpo-wfm-attendance-shrinkage-master"
    )!;
    const keys = wfmReport.columns.map((c) => c.key);
    expect(keys).toContain("ROSTER_DATE");
    expect(keys).toContain("PAYROLL_ATTENDANCE_INPUT");
  });
});
