import { describe, expect, it } from "vitest";
import { resolveLaunchRoute } from "../ModuleLauncher";

describe("resolveLaunchRoute", () => {
  it("trusts a catalog path the router mounts even without a page-code mapping", () => {
    expect(resolveLaunchRoute({ page_code: "FINANCE_BANK_ACCOUNTS", page_path: "/finance/bank-accounts" })).toBe("/finance/bank-accounts");
  });

  it("does not trust a catalog path nobody mounts", () => {
    expect(resolveLaunchRoute({ page_code: "SOME_NEW_CODE", page_path: "/not/a/route" })).toBe("/dashboard");
  });

  it("sends renamed pages to their current home instead of the dashboard", () => {
    expect(resolveLaunchRoute({ page_code: "LEAVE_MANAGEMENT", page_path: "/leave/dashboard" })).toBe("/leave-approvals");
    expect(resolveLaunchRoute({ page_code: "SALARY_PREP", page_path: "/salary-prep" })).toBe("/payroll/salary-review");
  });
});
