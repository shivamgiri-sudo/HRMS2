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
 *
 * Below, the "role that owns no stage here" example moved from GRN to BUDGET (2026-09-12):
 * accounts_head DOES now own a GRN stage — branch_head_approved -> accounts_head, see the 3-stage
 * chain added that day — so it stopped being an example of a role with no stage there at all. It
 * still owns no stage on BUDGET (that stage was removed there, 2026-08-21), which is the same
 * shape of refusal this test exists to pin.
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
        workflow: "budget",
      }),
    );
    expect(error).not.toBeNull();
    expect(error!.statusCode, "without a statusCode the message is replaced in production").toBe(403);
    expect(error!.code).toBe("WORKFLOW_WRONG_STAGE_ROLE");
    expect(error!.message).toMatch(/requires the finance_head role/);
  });

  it("on GRN, the same role/status pair now succeeds instead — accounts_head owns this stage there", () => {
    // The exact inverse of the case above, pinned side by side so the two workflows' divergence
    // (owner ruling, 2026-09-12) cannot silently re-collapse into one shared ternary again.
    expect(resolveFinanceStageRole({
      primaryRole: "accounts_head",
      userRoles: ["accounts_head"],
      currentStatus: "branch_head_approved",
      workflow: "grn",
    })).toBe("accounts_head");
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
    // The audit question is "which stage was cleared", not "who was logged in". GRN's 3-stage
    // chain (owner ruling, 2026-09-12) means branch_head_approved now waits on accounts_head,
    // not finance_head — same status string as before, different next owner for this workflow.
    expect(resolveFinanceStageRole({
      primaryRole: "super_admin", userRoles: ["super_admin"],
      currentStatus: "branch_head_approved", workflow: "grn",
    })).toBe("accounts_head");
    expect(resolveFinanceStageRole({
      primaryRole: "super_admin", userRoles: ["super_admin"],
      currentStatus: "accounts_head_approved", workflow: "grn",
    })).toBe("finance_head");
    // BUDGET is unaffected by the GRN change — same status, still finance_head there.
    expect(resolveFinanceStageRole({
      primaryRole: "super_admin", userRoles: ["super_admin"],
      currentStatus: "branch_head_approved", workflow: "budget",
    })).toBe("finance_head");
  });

  it("refuses accounts_head on a budget at finance_head_approved — that stage was removed (owner decision, 2026-08-21)", () => {
    const error = statusOf(() =>
      resolveFinanceStageRole({
        primaryRole: "accounts_head", userRoles: ["accounts_head"],
        currentStatus: "finance_head_approved", workflow: "budget",
      }),
    );
    expect(error).not.toBeNull();
    expect(error!.statusCode).toBe(409);
    expect(error!.code).toBe("WORKFLOW_NO_STAGE_FOR_STATUS");
  });
});
