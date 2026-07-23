import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  DASHBOARD_ACCESS_REGISTRY,
  canAccessDashboard,
  getDashboardDefinition,
  normalizeDashboardRole,
} from "../../../shared/dashboardAccessRegistry.js";

describe("dashboard access registry", () => {
  it("defines all twelve production dashboards with unique routes and page codes", () => {
    const definitions = Object.values(DASHBOARD_ACCESS_REGISTRY);

    expect(definitions).toHaveLength(12);
    expect(new Set(definitions.map((item) => item.route)).size).toBe(12);
    expect(new Set(definitions.map((item) => item.pageCode)).size).toBe(12);
  });

  it("normalizes supported aliases before checking entitlement", () => {
    expect(normalizeDashboardRole(" TL ")).toBe("team_leader");
    expect(normalizeDashboardRole("ops_manager")).toBe("operations_manager");
    expect(normalizeDashboardRole("payroll_hr")).toBe("payroll");
  });

  it("does not grant business dashboards to admin implicitly", () => {
    expect(canAccessDashboard("CEO_DASHBOARD", ["admin"])).toBe(false);
    expect(canAccessDashboard("SUPER_ADMIN_DASHBOARD", ["admin"])).toBe(false);
    expect(canAccessDashboard("SUPER_ADMIN_DASHBOARD", ["super_admin"])).toBe(true);
  });

  it("grants only explicitly listed role-dashboard combinations", () => {
    expect(canAccessDashboard("MANAGEMENT_DASHBOARD", ["tl"])).toBe(true);
    expect(canAccessDashboard("QUALITY_DASHBOARD", ["qa_analyst"])).toBe(true);
    expect(canAccessDashboard("QUALITY_DASHBOARD", ["recruiter"])).toBe(false);
    expect(getDashboardDefinition("NOT_A_DASHBOARD")).toBeNull();
  });

  it("matches the complete production role-dashboard matrix", () => {
    const expected: Record<string, string[]> = {
      admin: [],
      super_admin: Object.keys(DASHBOARD_ACCESS_REGISTRY),
      ceo: ["CEO_DASHBOARD", "EMPLOYEE_SELF_DASHBOARD"],
      hr: ["HR_DASHBOARD", "WFM_ATTENDANCE_DASHBOARD", "RECRUITER_DASHBOARD", "EMPLOYEE_SELF_DASHBOARD"],
      wfm: ["WFM_DASHBOARD", "WFM_ATTENDANCE_DASHBOARD", "EMPLOYEE_SELF_DASHBOARD"],
      payroll: ["PAYROLL_HR_DASHBOARD", "EMPLOYEE_SELF_DASHBOARD"],
      qa: ["QUALITY_DASHBOARD", "EMPLOYEE_SELF_DASHBOARD"],
      operations_manager: ["WFM_ATTENDANCE_DASHBOARD", "QUALITY_DASHBOARD", "OPERATIONS_DASHBOARD", "EMPLOYEE_SELF_DASHBOARD"],
      recruiter: ["RECRUITER_DASHBOARD", "EMPLOYEE_SELF_DASHBOARD"],
      it: ["IT_MANAGER_DASHBOARD", "EMPLOYEE_SELF_DASHBOARD"],
      manager: ["MANAGEMENT_DASHBOARD", "EMPLOYEE_SELF_DASHBOARD"],
      employee: ["EMPLOYEE_SELF_DASHBOARD"],
    };

    for (const [role, dashboardCodes] of Object.entries(expected)) {
      const actual = Object.keys(DASHBOARD_ACCESS_REGISTRY)
        .filter((code) => canAccessDashboard(code, [role]));
      expect(actual, role).toEqual(dashboardCodes);
    }
  });

  it("enforces entitlement on dynamic and fixed dashboard API routes", () => {
    const routes = readFileSync(
      resolve(process.cwd(), "src/modules/dashboards/dashboard.routes.ts"),
      "utf8",
    );

    expect(routes).toContain('router.param("dashboardCode"');
    expect(routes).toContain('requireFixedDashboard("EMPLOYEE_SELF_DASHBOARD")');
    expect(routes).toContain('requireFixedDashboard("PAYROLL_HR_DASHBOARD")');
    expect(routes).toContain('throw dashboardAccessError(`Not entitled to ${definition.code}`, 403)');
  });
});
