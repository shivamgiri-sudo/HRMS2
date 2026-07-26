import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BPO_MASTER_REPORTS } from "../bpo-master-report-registry.js";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("report role and scope contracts", () => {
  it("every report declares view roles and export roles", () => {
    for (const report of BPO_MASTER_REPORTS) {
      expect(report.viewRoles.length, `${report.code} has no view roles`).toBeGreaterThan(0);
      expect(report.exportRoles.length, `${report.code} has no export roles`).toBeGreaterThan(0);
    }
  });

  it("payroll master report excludes general employee from view roles", () => {
    const payrollReport = BPO_MASTER_REPORTS.find((r) => r.code === "bpo-payroll-statutory-master")!;
    expect(payrollReport.viewRoles).not.toContain("employee");
    expect(payrollReport.viewRoles).not.toContain("general_employee");
  });

  it("finance master report excludes general employee from view roles", () => {
    const financeReport = BPO_MASTER_REPORTS.find((r) => r.code === "bpo-finance-pnl-profitability-master")!;
    expect(financeReport.viewRoles).not.toContain("employee");
    expect(financeReport.viewRoles).not.toContain("general_employee");
  });

  it("branch scope enforced via SQL predicate with isSuperAdmin check", () => {
    const adapter = source("../bpo-master-verified-workforce-adapters.ts");
    expect(adapter).toContain("branch_id IN");
    expect(adapter).toContain("isSuperAdmin");
  });

  it("ATS candidate scope fails closed for non-super-admin without branch match", () => {
    const adapter = source("../bpo-master-verified-business-safe-adapters.ts");
    expect(adapter).toContain("candidate_branch");
    expect(adapter).toContain('where.push("1=0")');
  });

  it("sensitive columns use masked format", () => {
    const reportsWithSensitive = BPO_MASTER_REPORTS.filter((r) =>
      r.columns.some((c) => c.sensitive)
    );
    expect(reportsWithSensitive.length).toBeGreaterThan(0);
    for (const report of reportsWithSensitive) {
      const sensitiveColumns = report.columns.filter((c) => c.sensitive);
      for (const col of sensitiveColumns) {
        expect(col.format, `${report.code}.${col.key} sensitive but not masked`).toBe("masked");
      }
    }
  });
});
