import { describe, expect, it } from "vitest";
import { resolveFinanceStageRole } from "../finance-workflow-role.js";

/**
 * A reviewer must be told why their Approve was refused.
 *
 * errorHandler.ts only forwards `error.message` when the error carries a statusCode. A bare
 * `throw new Error(...)` is treated as an unexpected 500 and, in production, has its message
 * REPLACED with "An unexpected server error occurred. Please quote reference <hex>". Both
 * refusals here are reviewer-facing decisions, and both were bare throws.
 *
 * The live case: accounts_head is in TOPUP_REVIEW_ROLES, so requireRole lets them reach a
 * top-up's Approve button — but no top-up stage maps to accounts_head, so this resolver refused
 * them every time with an anonymous reference instead of "requires the finance_head role".
 * budget-topup.service.ts already fixed exactly this class of bug inside itself (see its header
 * comment about reference 538f315d); the resolver its route calls first was still doing it.
 */

const statusOf = (fn: () => unknown) => {
  try {
    fn();
    return null;
  } catch (error) {
    return (error as { statusCode?: number; code?: string; message: string });
  }
};

describe("a role that owns no stage here", () => {
  it("is refused 403 with the role it would need, not an anonymous 500", () => {
    const error = statusOf(() =>
      resolveFinanceStageRole({
        primaryRole: "accounts_head",
        userRoles: ["accounts_head"],
        currentStatus: "branch_head_approved",
        workflow: "grn",
      }),
    );
    expect(error).not.toBeNull();
    expect(error!.statusCode, "without a statusCode the message is replaced in production").toBe(403);
    expect(error!.code).toBe("WORKFLOW_WRONG_STAGE_ROLE");
    expect(error!.message).toMatch(/requires the finance_head role/);
  });
});

describe("a status that owns no stage at all", () => {
  it("is refused 409 — the row's state forbids it, the caller's role is not the problem", () => {
    const error = statusOf(() =>
      resolveFinanceStageRole({
        primaryRole: "finance_head",
        userRoles: ["finance_head"],
        currentStatus: "applied",
        workflow: "grn",
      }),
    );
    expect(error).not.toBeNull();
    expect(error!.statusCode).toBe(409);
    expect(error!.code).toBe("WORKFLOW_NO_STAGE_FOR_STATUS");
    expect(error!.message).toMatch(/No approval role is valid/);
  });
});

describe("what still passes", () => {
  it("returns the stage owner for the role that owns it", () => {
    expect(resolveFinanceStageRole({
      primaryRole: "branch_head", userRoles: ["branch_head"],
      currentStatus: "submitted", workflow: "grn",
    })).toBe("branch_head");
  });

  it("still records a super_admin as the stage owner, not as super_admin", () => {
    // The audit question is "which stage was cleared", not "who was logged in".
    expect(resolveFinanceStageRole({
      primaryRole: "super_admin", userRoles: ["super_admin"],
      currentStatus: "branch_head_approved", workflow: "grn",
    })).toBe("finance_head");
  });

  it("keeps the budget chain's third stage", () => {
    expect(resolveFinanceStageRole({
      primaryRole: "accounts_head", userRoles: ["accounts_head"],
      currentStatus: "finance_head_approved", workflow: "budget",
    })).toBe("accounts_head");
  });
});
