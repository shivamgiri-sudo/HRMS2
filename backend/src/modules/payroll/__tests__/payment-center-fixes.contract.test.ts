import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const BANK_ROUTES = stripComments(read("src/modules/payroll/bank-payment-readiness.routes.ts"));
const DISBURSAL_ROUTES = stripComments(read("src/modules/payroll/disbursal.routes.ts"));
const PAGE = stripComments(read("../src/pages/payroll/PaymentDisbursalCenter.tsx"));

describe("Payment Center - salary transfer export needs an approved run", () => {
  const handler = BANK_ROUTES.slice(
    BANK_ROUTES.indexOf("function handleSalaryTransferExport"),
    BANK_ROUTES.indexOf('"/salary-transfer/export"'),
  );

  it("refuses a run that is neither approved nor closed", () => {
    expect(handler).toContain("RUN_NOT_APPROVED");
    expect(handler).toContain('exportStatus !== "approved" && !isRunClosed(exportStatus)');
  });

  it("checks the run status BEFORE any batch is generated", () => {
    expect(handler.indexOf("RUN_NOT_APPROVED")).toBeGreaterThan(-1);
    expect(handler.indexOf("RUN_NOT_APPROVED")).toBeLessThan(handler.indexOf("generateSalaryTransferBatch("));
  });

  it("returns 404 for an unknown run instead of exporting", () => {
    expect(handler).toContain("Payroll run not found");
  });
});

describe("Payment Center - the heads who can lock and disburse can use the Disbursal tab", () => {
  it("backend disbursal routes admit payroll_head, finance_head and payroll_admin", () => {
    const matches = DISBURSAL_ROUTES.match(/requireRole\("payroll", "super_admin", "finance", "payroll_head", "finance_head", "payroll_admin"\)/g) ?? [];
    expect(matches.length).toBe(2);
  });

  it("the page's write-role list matches the backend", () => {
    const m = PAGE.match(/const DISBURSAL_WRITE_ROLES = \[([^\]]*)\]/);
    expect(m).toBeTruthy();
    const roles = m![1].split(",").map((r) => r.trim().replace(/"/g, ""));
    for (const r of ["payroll", "super_admin", "finance", "payroll_head", "finance_head", "payroll_admin"]) {
      expect(roles).toContain(r);
    }
  });
});

describe("Payment Center - one export path that records a batch", () => {
  it("'Download payment file' no longer links to the unrecorded /payment-file route", () => {
    expect(PAGE).not.toContain("/payment-file?run_id=");
    expect(PAGE).toContain("void downloadSalaryTransferFile(false)");
  });
});
