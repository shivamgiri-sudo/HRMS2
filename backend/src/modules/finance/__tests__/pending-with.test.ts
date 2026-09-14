import { describe, expect, it } from "vitest";
import {
  resolveFinanceStageRole,
  resolvePendingWith,
} from "../finance-workflow-role.js";

/**
 * "Pending With" for the top-up queue (Requirement 1).
 *
 * Nothing is stored. Pending-with is a pure function of status, so a column would be a second
 * source of truth free to drift from the status it claims to describe — and the brief asks
 * for exactly that: derive it, do not duplicate it.
 *
 * The important boundary is that this is NOT a relaxed resolveFinanceStageRole. That function
 * throws for a status with no valid stage, and the throw is an authorisation check: it is what
 * stops someone approving a stage that is not theirs. Softening it so a list could render
 * would turn a security guard into a label formatter. The two are asserted side by side below
 * so nobody later "simplifies" one into the other.
 */

describe("resolvePendingWith — the live top-up chain", () => {
  it("puts a submitted request with the Branch Head", () => {
    const p = resolvePendingWith("submitted");
    expect(p.role).toBe("branch_head");
    expect(p.label).toBe("Branch Head");
    expect(p.isPending).toBe(true);
  });

  it("moves it to the Finance Head after branch approval", () => {
    const p = resolvePendingWith("branch_head_approved");
    expect(p.role).toBe("finance_head");
    expect(p.isPending).toBe(true);
  });

  it("reports applied as completed, owing nobody", () => {
    const p = resolvePendingWith("applied");
    expect(p.role).toBeNull();
    expect(p.label).toBe("Completed");
    expect(p.isPending).toBe(false);
  });

  it("reports rejected as rejected, not as pending", () => {
    const p = resolvePendingWith("rejected");
    expect(p.isPending).toBe(false);
    expect(p.label).toBe("Rejected");
  });
});

describe("resolvePendingWith — the cases that could mislead", () => {
  it("treats a dead finance_head_approved top-up as completed, not stuck", () => {
    // Declared on the enum but never written: the service goes straight to 'applied'. A legacy
    // row carrying it must not appear to be waiting on somebody who has already acted.
    expect(resolvePendingWith("finance_head_approved", "topup").isPending).toBe(false);
  });

  it("treats a dead finance_head_approved budget as completed too, not stuck on Accounts Head", () => {
    // The Accounts Head stage was removed from the budget header workflow (owner decision,
    // 2026-08-21) — Finance Head approval now goes straight to 'active', same shape as top-up's
    // straight-to-'applied'. A legacy row (e.g. one migrated by
    // 1523_branch_budget_drop_accounts_head_stage.sql) must not appear to be waiting on Accounts
    // Head, a stage that can no longer act on anything.
    const p = resolvePendingWith("finance_head_approved", "budget");
    expect(p.role).toBeNull();
    expect(p.label).toBe("Completed");
    expect(p.isPending).toBe(false);
  });

  it("says Unknown for an unrecognised status rather than guessing", () => {
    // Silently rendering "Completed" for a status nobody anticipated is how a stuck request
    // stops being chased.
    const p = resolvePendingWith("some_future_status");
    expect(p.label).toBe("Unknown");
    expect(p.isPending).toBe(false);
  });

  it("never returns an empty label", () => {
    for (const status of ["submitted", "branch_head_approved", "applied", "rejected", "draft", "", "nonsense"]) {
      expect(resolvePendingWith(status).label.length).toBeGreaterThan(0);
    }
  });
});

describe("it must not become a substitute for the authorisation check", () => {
  it("resolveFinanceStageRole still throws where resolvePendingWith merely reports", () => {
    // Same status, two different jobs. If this test ever fails because the throw was removed,
    // an approval guard has been turned into a label.
    expect(resolvePendingWith("applied").label).toBe("Completed");
    expect(() =>
      resolveFinanceStageRole({
        primaryRole: "finance_head",
        userRoles: ["finance_head"],
        currentStatus: "applied",
        workflow: "grn",
      }),
    ).toThrow(/No approval role is valid/i);
  });

  it("resolveFinanceStageRole still refuses a user who does not hold the stage role", () => {
    expect(() =>
      resolveFinanceStageRole({
        primaryRole: "branch_admin",
        userRoles: ["branch_admin"],
        currentStatus: "submitted",
        workflow: "grn",
      }),
    ).toThrow(/requires the branch_head role/i);
  });
});
