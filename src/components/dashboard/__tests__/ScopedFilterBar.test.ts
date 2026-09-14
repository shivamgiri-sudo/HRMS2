import { describe, expect, it } from "vitest";
import { isBranchFilterRestrictedToOne } from "../ScopedFilterBar";

/**
 * ScopedFilterBar's branch dropdown always offered an "All Branches" choice and defaulted
 * its display to that label, even for a caller whose scope the backend has already pinned
 * to one branch — /api/dashboards/:code/summary silently ignores the branchId query param
 * unless scope.level is ORG_ALL, so a branch_head reading "All Branches" over their own
 * dashboard was seeing a real option that did nothing on the server.
 *
 * Verified live 2026-08-28: a branch_head's /api/dashboards/HR_DASHBOARD/filters returns
 * `{"branches":[{"id":"...","name":"NOIDA"}],"scope":{"level":"BRANCH_ALL"}}` — exactly the
 * shape these tests assert triggers the fix.
 */
describe("isBranchFilterRestrictedToOne", () => {
  it("is true for the exact reported case: dashboard-scoped, restricted, one branch", () => {
    expect(isBranchFilterRestrictedToOne("HR_DASHBOARD", "BRANCH_ALL", 1)).toBe(true);
  });

  it("is false for org-wide scope, even with one branch returned", () => {
    // A genuinely single-branch company under an ORG_ALL caller must still offer "All
    // Branches" as a real, correct choice — it is not restricting anything.
    expect(isBranchFilterRestrictedToOne("HR_DASHBOARD", "ORG_ALL", 1)).toBe(false);
  });

  it("is false for a restricted caller covering more than one branch", () => {
    // A multi-site manager's "All Branches" is a meaningful choice (all branches they can
    // see), not a misleading one — only the single-branch case is the bug.
    expect(isBranchFilterRestrictedToOne("HR_DASHBOARD", "BRANCH_ALL", 3)).toBe(false);
  });

  it("is false for the non-dashboard caller path (no dashboardCode)", () => {
    // /api/org/branches has no scope concept — Employees, Org Chart and every other
    // non-dashboard consumer of this shared component must be completely unaffected.
    expect(isBranchFilterRestrictedToOne(undefined, null, 1)).toBe(false);
  });

  it("is false while scope has not loaded yet (null, not a level)", () => {
    // Distinguishes "haven't heard back yet" from "heard back and it's ORG_ALL" — a
    // loading dashboard fetch must not flash the restricted UI before scope is known.
    expect(isBranchFilterRestrictedToOne("HR_DASHBOARD", null, 1)).toBe(false);
  });

  it("is false with zero branches (nothing to restrict to)", () => {
    expect(isBranchFilterRestrictedToOne("HR_DASHBOARD", "BRANCH_ALL", 0)).toBe(false);
  });
});
