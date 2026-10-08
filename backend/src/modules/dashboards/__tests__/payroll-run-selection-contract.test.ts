import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const routes = readFileSync(resolve(process.cwd(), "src/modules/dashboards/dashboard.routes.ts"), "utf8");

describe("payroll dashboard run selection", () => {
  it("requires an explicit run id", () => {
    const payrollRoute = routes.slice(
      routes.indexOf('router.get("/PAYROLL_HR_DASHBOARD/operational-summary"'),
      routes.indexOf('router.get("/:dashboardCode/summary"'),
    );

    expect(payrollRoute).toContain("PAYROLL_RUN_REQUIRED");
    expect(payrollRoute).toContain("WHERE id = ?");
    expect(payrollRoute).not.toContain("WHERE run_month = ?");
    expect(payrollRoute).not.toContain("ORDER BY created_at DESC LIMIT 1");
    expect(payrollRoute).not.toContain(".catch(() => 0)");
    expect(payrollRoute).not.toContain(".catch(() => [])");
    expect(payrollRoute).not.toContain(".catch(() => ({");
    expect(payrollRoute).not.toContain("FROM payroll_disbursal WHERE pay_month");
    expect(payrollRoute).not.toContain("FROM employee_loan");
    expect(payrollRoute).not.toContain("FROM reimbursement_claim");
    expect(payrollRoute).toContain("unavailableSources");
  });
});
