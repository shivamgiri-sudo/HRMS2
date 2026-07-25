import { describe, expect, it } from "vitest";

import {
  COMMON_USER_PAGE_CODES,
  getRolePageCodes,
  ROLE_DASHBOARD_PAGE_CODES,
} from "@/lib/rbacPageMatrix";

describe("rbac page matrix", () => {
  it.each(["employee", "admin", "hr", "finance", "wfm", "recruiter", "manager", "qa", "ceo"])(
    "includes common user pages for %s",
    (roleKey) => {
      const pages = getRolePageCodes(roleKey);

      expect(COMMON_USER_PAGE_CODES.every((pageCode) => pages.includes(pageCode))).toBe(true);
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
