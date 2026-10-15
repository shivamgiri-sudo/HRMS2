import { afterEach, describe, expect, it, vi } from "vitest";
import { canAccessRoleDashboard, resolveRoleDashboardVariant } from "../roleDashboardAccess";

afterEach(() => vi.unstubAllEnvs());

describe("branch_head variant, flag off (default)", () => {
  it("is unchanged for branch_head users", () => {
    expect(resolveRoleDashboardVariant(["branch_head"])).toBe("wfm_attendance");
    expect(resolveRoleDashboardVariant(["branch_head", "hr", "manager"])).toBe("hr");
  });
  it("cannot be accessed", () => {
    expect(canAccessRoleDashboard("branch_head", ["branch_head"])).toBe(false);
    expect(canAccessRoleDashboard("branch_head", ["super_admin"])).toBe(false);
  });
});

describe("branch_head variant, flag on", () => {
  it("wins over hr and manager", () => {
    vi.stubEnv("VITE_BRANCH_HEAD_HEALTH_ENABLED", "true");
    expect(resolveRoleDashboardVariant(["branch_head", "hr", "manager"])).toBe("branch_head");
    expect(canAccessRoleDashboard("branch_head", ["branch_head"])).toBe(true);
  });
  it("hr alone still hr; ceo still beats branch_head", () => {
    vi.stubEnv("VITE_BRANCH_HEAD_HEALTH_ENABLED", "true");
    expect(resolveRoleDashboardVariant(["hr"])).toBe("hr");
    expect(resolveRoleDashboardVariant(["ceo", "branch_head"])).toBe("ceo");
  });
  it("explicit option overrides env", () => {
    expect(resolveRoleDashboardVariant(["branch_head"], { branchHeadEnabled: true })).toBe("branch_head");
  });
});
