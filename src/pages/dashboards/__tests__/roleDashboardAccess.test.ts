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
  it("does not grant any role dashboard to plain admin", () => {
    expect(ALL_VARIANTS.filter((variant) => canAccessRoleDashboard(variant, ["admin"]))).toEqual([]);
  });

  it("resolves the most privileged entitled dashboard for multi-role users", () => {
    expect(resolveRoleDashboardVariant(["employee", "process_manager"])).toBe("manager");
    expect(resolveRoleDashboardVariant(["employee", "finance"])).toBe("payroll");
    expect(resolveRoleDashboardVariant(["employee", "ceo"])).toBe("ceo");
  });
});
