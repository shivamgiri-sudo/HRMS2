import { describe, expect, it } from "vitest";
import { resolveRoleDashboardVariant } from "../roleDashboardAccess";

describe("branch_head variant", () => {
  it("branch_head wins over hr and manager", () => {
    expect(resolveRoleDashboardVariant(["branch_head", "hr", "manager"])).toBe("branch_head");
  });
  it("hr alone still resolves to hr", () => {
    expect(resolveRoleDashboardVariant(["hr"])).toBe("hr");
  });
  it("ceo still outranks branch_head", () => {
    expect(resolveRoleDashboardVariant(["ceo", "branch_head"])).toBe("ceo");
  });
});
