/**
 * Which readiness view each real user gets.
 *
 * WHAT THIS EXISTS TO CATCH. On 2026-09-04 every Branch Head opening /payroll/readiness saw
 * "No branches found for 2026-08" with four zeroed counters. Nothing errored. The cause was one
 * role key: `hr` was listed as an HO role, GET /branch-readiness/summary does not admit `hr`, and
 * every Branch Head in production also holds `hr`. So they were handed the org-wide view, its only
 * data request was refused, and an empty list rendered as a statement about the month.
 *
 * The fixtures below are the ACTUAL role sets from production user_roles on 2026-09-04, not
 * invented ones. That matters: the bug is invisible against tidy single-role fixtures — a
 * `branch_head` on its own classifies correctly both before and after the fix. It only appears once
 * the real combination `branch_head + employee + hr` is used, which is what every Branch Head has.
 */

import { describe, expect, it } from "vitest";
import { readinessViewFor } from "../readinessViewScope";

/** Real role sets, production user_roles, 2026-09-04. */
const LIVE = {
  branchHeadNoida2: ["branch_head", "employee", "hr"],
  branchHeadNoida: ["branch_head", "employee", "hr"],
  branchHeadAhmedabad: ["branch_head", "employee", "hr"],
  branchWfm: ["employee", "wfm"],
  branchPayrollHrNoida: ["employee", "hr", "payroll_hr", "wfm"],
  payrollHead: ["accounts_head", "branch_admin", "branch_head", "employee", "finance_head", "payroll_head"],
  superAdmin: [
    "admin", "branch_admin", "branch_head", "employee", "finance",
    "payroll_admin", "payroll_head", "payroll_hr", "super_admin",
  ],
} as const;

describe("branch users get their own branch, not the HO roll-up", () => {
  it("routes all three live Branch Heads to their own branch", () => {
    // The regression: each of these holds `hr`, and `hr` used to mean HO.
    for (const roles of [LIVE.branchHeadNoida2, LIVE.branchHeadNoida, LIVE.branchHeadAhmedabad]) {
      expect(readinessViewFor(roles), `[${roles.join(", ")}]`).toBe("own-branch");
    }
  });

  it("routes Branch WFM to their own branch", () => {
    expect(readinessViewFor(LIVE.branchWfm)).toBe("own-branch");
  });

  it("routes Branch Payroll HR to their own branch", () => {
    expect(readinessViewFor(LIVE.branchPayrollHrNoida)).toBe("own-branch");
  });

  it("routes a Branch Payroll HR holding no other branch role to their own branch", () => {
    /*
     * payroll_hr was absent from the branch list, so this user matched neither arm and was shown
     * "You do not have access to the branch view" — on the page their job runs on. No live user is
     * in this exact state today (all four also hold wfm or hr), which is why it went unnoticed.
     */
    expect(readinessViewFor(["employee", "payroll_hr"])).toBe("own-branch");
  });
});

describe("HO users still get the org-wide view", () => {
  it("keeps the Payroll Head on the HO roll-up even though they also hold branch_head", () => {
    // Both arms match; HO must win, and their scope rows are scope_type 'all'.
    expect(readinessViewFor(LIVE.payrollHead)).toBe("ho");
  });

  it("keeps super_admin on the HO roll-up", () => {
    expect(readinessViewFor(LIVE.superAdmin)).toBe("ho");
  });
});

describe("the HO list may only contain roles /summary actually admits", () => {
  it("does not treat hr as HO", () => {
    /*
     * The invariant, stated as the case that broke. GET /branch-readiness/summary admits
     * payroll_head, super_admin, payroll and admin. A role classified HO but refused there gets a
     * view that cannot load, and the failure surfaces as an empty month rather than a denial.
     */
    expect(readinessViewFor(["employee", "hr"])).not.toBe("ho");
  });

  it("does not treat finance as HO", () => {
    expect(readinessViewFor(["employee", "finance"])).not.toBe("ho");
  });

  it("treats each role /summary admits as HO", () => {
    for (const role of ["payroll_head", "super_admin", "payroll", "admin"]) {
      expect(readinessViewFor([role]), role).toBe("ho");
    }
  });
});

describe("someone with no readiness role is told so", () => {
  it("returns none rather than an empty branch view", () => {
    // "none" renders an explicit access message. Returning own-branch here would show a user with
    // no branch scope an empty grid and no reason for it.
    expect(readinessViewFor(["employee"])).toBe("none");
    expect(readinessViewFor([])).toBe("none");
  });
});
