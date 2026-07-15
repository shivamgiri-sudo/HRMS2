import { describe, expect, it } from "vitest";
import {
  canAccessRoleDashboard,
  resolveRoleDashboardVariant,
} from "../roleDashboardAccess";
import { asNumber, metricDetail, percent } from "../reference-dashboard-model";

describe("resolveRoleDashboardVariant", () => {
  it("prioritises super admin over all other roles", () => {
    expect(resolveRoleDashboardVariant(["employee", "hr", "super_admin"])).toBe("super_admin");
  });

  it("maps finance and payroll aliases to payroll", () => {
    expect(resolveRoleDashboardVariant(["finance_head"])).toBe("payroll");
    expect(resolveRoleDashboardVariant(["payroll_branch"])).toBe("payroll");
  });

  it("maps team leadership aliases to manager", () => {
    expect(resolveRoleDashboardVariant(["team_lead"])).toBe("manager");
    expect(resolveRoleDashboardVariant(["tl"])).toBe("manager");
  });

  it("defaults unknown roles to employee", () => {
    expect(resolveRoleDashboardVariant(["unknown_role"])).toBe("employee");
  });
});

describe("canAccessRoleDashboard", () => {
  it("allows super admin to open every role dashboard", () => {
    expect(canAccessRoleDashboard("payroll", ["super_admin"])).toBe(true);
    expect(canAccessRoleDashboard("wfm", ["super_admin"])).toBe(true);
  });

  it("rejects direct navigation to a dashboard outside the assigned roles", () => {
    expect(canAccessRoleDashboard("hr", ["employee"])).toBe(false);
    expect(canAccessRoleDashboard("ceo", ["manager"])).toBe(false);
  });
});

describe("dashboard metric helpers", () => {
  it("handles null and invalid numeric values", () => {
    expect(asNumber(null)).toBeNull();
    expect(asNumber("not-a-number")).toBeNull();
  });

  it("calculates a one-decimal percentage", () => {
    expect(percent(9, 11)).toBe(81.8);
    expect(percent(null, 11)).toBeNull();
    expect(percent(1, 0)).toBeNull();
  });

  it("reads a metric detail safely", () => {
    expect(metricDetail({ att: { detail: { present: 18 } } }, "att", "present")).toBe(18);
    expect(metricDetail({}, "att", "present")).toBeNull();
  });
});
