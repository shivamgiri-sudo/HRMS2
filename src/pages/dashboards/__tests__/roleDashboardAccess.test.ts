import { describe, expect, it } from "vitest";

import {
  canAccessRoleDashboard,
  resolveRoleDashboardVariant,
  type RoleDashboardVariant,
} from "../roleDashboardAccess";

const ALL_VARIANTS: RoleDashboardVariant[] = [
  "super_admin",
  "ceo",
  "hr",
  "wfm",
  "wfm_attendance",
  "payroll",
  "quality",
  "operations",
  "recruiter",
  "it_manager",
  "manager",
  "employee",
];

describe("role dashboard access", () => {
  it("grants plain admin the self dashboard and nothing privileged", () => {
    // Previously asserted [] — but 8 real users hold `admin`, and an empty result meant
    // they could open no dashboard at all while role_page_access granted them the self
    // dashboard. Administrative roles get the self dashboard; nothing business-facing.
    expect(ALL_VARIANTS.filter((variant) => canAccessRoleDashboard(variant, ["admin"])))
      .toEqual(["employee"]);
  });

  it("grants the other administrative roles the self dashboard only", () => {
    for (const role of ["trainer", "branch_admin", "interviewer"]) {
      expect(ALL_VARIANTS.filter((variant) => canAccessRoleDashboard(variant, [role])), role)
        .toEqual(["employee"]);
    }
  });

  it("routes the head roles added 2026-07-30 to their function's dashboard", () => {
    expect(canAccessRoleDashboard("it_manager", ["it_head"])).toBe(true);
    expect(canAccessRoleDashboard("quality", ["tq_head"])).toBe(true);
    expect(canAccessRoleDashboard("payroll", ["finance_head"])).toBe(true);
    expect(canAccessRoleDashboard("payroll", ["accounts_head"])).toBe(true);
  });

  it("resolves the most privileged entitled dashboard for multi-role users", () => {
    expect(resolveRoleDashboardVariant(["employee", "process_manager"])).toBe("manager");
    expect(resolveRoleDashboardVariant(["employee", "finance"])).toBe("payroll");
    expect(resolveRoleDashboardVariant(["employee", "ceo"])).toBe("ceo");
  });

  it("lands the real multi-role accounts on a sensible dashboard", () => {
    // Role combinations taken from live user_roles rows, not invented. A head role must
    // not be out-ranked into a narrower dashboard than its remit.
    expect(resolveRoleDashboardVariant(["employee", "finance_head", "payroll_head"])).toBe("payroll");
    expect(resolveRoleDashboardVariant(["employee", "accounts_head", "process_manager"])).toBe("payroll");
    expect(resolveRoleDashboardVariant(["employee", "payroll_admin", "payroll_hr"])).toBe("payroll");
    expect(resolveRoleDashboardVariant(["branch_it", "employee", "it"])).toBe("it_manager");
    expect(resolveRoleDashboardVariant(["admin", "employee", "super_admin"])).toBe("super_admin");
    expect(resolveRoleDashboardVariant(["admin", "hr", "recruiter"])).toBe("hr");
    expect(resolveRoleDashboardVariant(["employee", "hr", "payroll"])).toBe("hr");
    expect(resolveRoleDashboardVariant(["employee", "interviewer"])).toBe("employee");
    // Administrative-only roles must never out-rank a real functional role.
    expect(resolveRoleDashboardVariant(["admin", "employee"])).toBe("employee");
  });

  it("routes each newly catalogued head role to its own function", () => {
    expect(resolveRoleDashboardVariant(["employee", "it_head"])).toBe("it_manager");
    expect(resolveRoleDashboardVariant(["employee", "tq_head"])).toBe("quality");
    expect(resolveRoleDashboardVariant(["employee", "branch_head"])).toBe("manager");
  });
});
