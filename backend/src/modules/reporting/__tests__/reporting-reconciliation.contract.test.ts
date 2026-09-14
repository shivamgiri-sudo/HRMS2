import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("reporting reconciliation contracts", () => {
  it("payroll net pay adapter uses salary_prep_line as authoritative source", () => {
    const adapter = source("../bpo-master-verified-workforce-adapters.ts");
    expect(adapter).toContain("salary_prep_line");
    expect(adapter).toContain('NET_PAY:["net_salary"]');
    expect(adapter).toContain('BASIC_PAY:["basic"]');
  });

  it("payroll adapter joins to salary_prep_run for run-level identification", () => {
    const adapter = source("../bpo-master-verified-workforce-adapters.ts");
    expect(adapter).toContain("salary_prep_run");
    expect(adapter).toContain("PAYROLL_RUN_ID");
  });

  it("P&L adapter uses canonical allocation-aware engine not billing_rate shortcut", () => {
    const canonical = source("../bpo-master-canonical-adapters.ts");
    expect(canonical).toContain("bpoPnlAllocationOverlayService");
    expect(canonical).not.toContain("billing_rate * headcount");
  });

  it("validation service computes distinct grain and duplicate grain counts", () => {
    const validation = source("../bpo-master-validation.service.ts");
    expect(validation).toContain("distinctGrainCount");
    expect(validation).toContain("duplicateGrainCount");
  });

  it("validation service tracks source row count and unavailable field count", () => {
    const validation = source("../bpo-master-validation.service.ts");
    expect(validation).toContain("sourceRowCount");
    expect(validation).toContain("unavailableFieldCount");
  });

  it("external quality schema is fully qualified with db_audit prefix", () => {
    const business = source("../bpo-master-verified-business-adapters.ts");
    expect(business).toContain("db_audit.call_quality_assessment");
  });
});
