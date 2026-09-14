import { describe, expect, it } from "vitest";

import {
  COMMON_USER_PAGE_CODES,
  getRolePageCodes,
  ROLE_DASHBOARD_PAGE_CODES,
  ROLE_EXCLUDED_PAGE_CODES,
} from "@/lib/rbacPageMatrix";

describe("rbac page matrix", () => {
  it.each(["employee", "admin", "hr", "finance", "wfm", "recruiter", "manager", "qa", "ceo"])(
    "includes common user pages for %s",
    (roleKey) => {
      const pages = getRolePageCodes(roleKey);

      // Every common page EXCEPT any the role explicitly excludes. The blanket
      // "all roles get all common pages" assertion stopped holding on 31-Jul-2026,
      // when ROLE_EXCLUDED_PAGE_CODES was introduced so the CEO — who is not
      // measured on operational KPIs — no longer receives MY_KPI.
      //
      // Deriving the expectation from ROLE_EXCLUDED_PAGE_CODES rather than
      // hardcoding the CEO keeps this test meaningful: an undocumented removal
      // still fails, only a declared one passes.
      const excluded = new Set(ROLE_EXCLUDED_PAGE_CODES[roleKey] ?? []);
      const expected = COMMON_USER_PAGE_CODES.filter((pageCode) => !excluded.has(pageCode));

      expect(expected.every((pageCode) => pages.includes(pageCode))).toBe(true);
      // And an excluded page really is absent, not merely tolerated.
      for (const pageCode of excluded) {
        expect(pages).not.toContain(pageCode);
      }
    },
  );

  it("keeps admin away from department role dashboards except the common self dashboard", () => {
    const pages = getRolePageCodes("admin");
    const forbiddenDashboards = ROLE_DASHBOARD_PAGE_CODES.filter(
      (pageCode) => pageCode !== "EMPLOYEE_SELF_DASHBOARD",
    );

    expect(pages).toContain("EMPLOYEE_SELF_DASHBOARD");
    expect(pages.filter((pageCode) => forbiddenDashboards.includes(pageCode as any))).toEqual([]);
  });

  it("keeps finance focused away from ATS and WFM operations", () => {
    const pages = getRolePageCodes("finance");

    expect(pages).toContain("EXPENSE_FINANCE");
    expect(pages).toContain("PROCUREMENT");
    expect(pages).not.toContain("ATS_DASHBOARD");
    expect(pages).not.toContain("WFM_ROSTER");
  });

  it("returns all provided active pages for super admin", () => {
    const activePages = ["MY_PROFILE", "ATS_DASHBOARD", "PAYROLL", "ACCESS_CONTROL"];

    expect(getRolePageCodes("super_admin", activePages)).toEqual(activePages);
  });
});
