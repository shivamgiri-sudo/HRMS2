import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A branch-bound role outranks a generic global one.
 *
 * The Branch Budget workspace showed a branch admin every branch's budget. The cause was not a
 * missing filter — resolveFinanceBranchScope was wired into the endpoints — but the role set it
 * consults: GLOBAL_FINANCE_ROLES contains `admin`, and live branch-admin accounts carry `admin`
 * alongside `branch_admin`, so the resolver answered "all branches".
 *
 * The rule these tests pin down is deliberately narrow:
 *   - `branch_admin` beats `admin`, because `admin` is a generic grant that says nothing about
 *     reviewing other branches' budgets;
 *   - `branch_admin` does NOT beat finance_head/accounts_head/ceo/coo/finance/payroll_head,
 *     because BUDGET_REVIEW_ROLES requires those roles to read every branch or the approval
 *     chain stalls — and at least one live account holds branch_admin with finance_head for
 *     exactly that reason.
 *
 * The role combinations below are the ones that actually exist in mas_hrms.user_roles, not
 * invented ones.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

beforeEach(() => {
  execute.mockReset();
  execute.mockResolvedValue([[{ branch_id: "branch-own" }], []]);
});

describe("hasGlobalFinanceScope — branch-bound precedence", () => {
  it("denies global scope to a branch admin who also holds admin", async () => {
    // The live regression: admin + branch_admin + employee.
    const { hasGlobalFinanceScope } = await import("../finance-access-scope.js");
    expect(hasGlobalFinanceScope("branch_admin", ["admin", "branch_admin", "employee"])).toBe(false);
    expect(
      hasGlobalFinanceScope("admin", ["admin", "branch_admin", "employee"]),
      "the primary role is just another role here — admin as primary must not re-open it",
    ).toBe(false);
  });

  it("keeps global scope for a branch admin who is also a Finance Head", async () => {
    // Live account: branch_admin + employee + finance_head + payroll_head. As a budget reviewer
    // they must still read every branch.
    const { hasGlobalFinanceScope } = await import("../finance-access-scope.js");
    expect(
      hasGlobalFinanceScope("branch_admin", ["branch_admin", "employee", "finance_head", "payroll_head"]),
    ).toBe(true);
  });

  it("leaves a plain branch admin branch-scoped, as before", async () => {
    // Live account: branch_admin + employee + process_manager. Already correct; must stay correct.
    const { hasGlobalFinanceScope } = await import("../finance-access-scope.js");
    expect(hasGlobalFinanceScope("branch_admin", ["branch_admin", "employee", "process_manager"])).toBe(false);
  });

  it("leaves every non-branch-bound role exactly as it was", async () => {
    const { hasGlobalFinanceScope } = await import("../finance-access-scope.js");
    expect(hasGlobalFinanceScope("admin", ["admin"]), "admin alone is still global").toBe(true);
    expect(hasGlobalFinanceScope("super_admin", ["super_admin"])).toBe(true);
    expect(hasGlobalFinanceScope("finance_head", ["finance_head"])).toBe(true);
    expect(hasGlobalFinanceScope("ceo", ["ceo"])).toBe(true);
    expect(hasGlobalFinanceScope("branch_head", ["branch_head"]), "branch_head was never global").toBe(false);
    expect(hasGlobalFinanceScope("employee", ["employee"])).toBe(false);
    expect(hasGlobalFinanceScope(undefined, undefined), "no roles at all must not be global").toBe(false);
  });
});

describe("resolveFinanceBranchScope — end-to-end effect on the budget list", () => {
  it("pins an admin+branch_admin to their own branch instead of returning all branches", async () => {
    const { resolveFinanceBranchScope } = await import("../finance-access-scope.js");
    // undefined here would mean "no WHERE clause" in branchBudgetService.list — every branch.
    expect(
      await resolveFinanceBranchScope({
        userId: "u1", primaryRole: "branch_admin", userRoles: ["admin", "branch_admin", "employee"],
      }),
    ).toBe("branch-own");
  });

  it("refuses an admin+branch_admin who explicitly asks for another branch", async () => {
    const { resolveFinanceBranchScope } = await import("../finance-access-scope.js");
    await expect(
      resolveFinanceBranchScope({
        userId: "u1",
        primaryRole: "branch_admin",
        userRoles: ["admin", "branch_admin", "employee"],
        requestedBranchId: "branch-someone-else",
      }),
    ).rejects.toThrow(/only access finance records for your assigned branch/i);
  });

  it("still lets a Finance Head narrow to any branch they choose", async () => {
    const { resolveFinanceBranchScope } = await import("../finance-access-scope.js");
    expect(
      await resolveFinanceBranchScope({
        userId: "u2",
        primaryRole: "branch_admin",
        userRoles: ["branch_admin", "finance_head"],
        requestedBranchId: "branch-any",
      }),
    ).toBe("branch-any");
  });
});

describe("assertFinanceRecordBranch — record-level guard for the id-addressed endpoints", () => {
  it("denies a record whose branch is unknown", async () => {
    // getMeterBranchId/getCostCentreBranchId return null for a missing or unmapped record. That
    // must read as a denial, never as "unrestricted".
    const { assertFinanceRecordBranch } = await import("../finance-access-scope.js");
    await expect(
      assertFinanceRecordBranch({
        userId: "u1", primaryRole: "branch_admin", userRoles: ["branch_admin"], recordBranchId: null,
      }),
    ).rejects.toThrow(/cannot access a finance record from another branch/i);
  });

  it("denies another branch's record to an admin+branch_admin", async () => {
    const { assertFinanceRecordBranch } = await import("../finance-access-scope.js");
    await expect(
      assertFinanceRecordBranch({
        userId: "u1",
        primaryRole: "branch_admin",
        userRoles: ["admin", "branch_admin"],
        recordBranchId: "branch-someone-else",
      }),
    ).rejects.toThrow(/cannot access a finance record from another branch/i);
  });

  it("allows their own branch's record", async () => {
    const { assertFinanceRecordBranch } = await import("../finance-access-scope.js");
    await expect(
      assertFinanceRecordBranch({
        userId: "u1", primaryRole: "branch_admin", userRoles: ["admin", "branch_admin"], recordBranchId: "branch-own",
      }),
    ).resolves.toBeUndefined();
  });
});

/**
 * excludeStageRoles — the GRN Branch Head bucket must not inherit finance_head/accounts_head's
 * "see every branch" override.
 *
 * Live incident (PND-9B020B7F, 2026-10-13): a Finance Head who also holds Branch Head for one
 * branch saw EVERY branch's Branch-Head-pending GRNs in their queue, because finance_head is in
 * OVERRIDING_GLOBAL_FINANCE_ROLES. Clearing another branch's Branch Head stage, then trying to
 * clear their own Finance Head stage on the same GRN, hit the maker-checker guard with no
 * second Finance Head able to step in. excludeStageRoles=true (passed only for the Branch Head
 * bucket / status='submitted') must pin them to their own branch instead, while every other
 * caller of these functions — which never passes it — keeps the exact behaviour above.
 */
describe("excludeStageRoles — Branch Head bucket must not inherit finance_head/accounts_head's override", () => {
  it("still grants global scope by default (excludeStageRoles omitted) — no regression", async () => {
    const { hasGlobalFinanceScope } = await import("../finance-access-scope.js");
    expect(hasGlobalFinanceScope("branch_admin", ["branch_admin", "finance_head"])).toBe(true);
  });

  it("denies global scope to finance_head when excludeStageRoles is set", async () => {
    const { hasGlobalFinanceScope } = await import("../finance-access-scope.js");
    expect(hasGlobalFinanceScope("branch_admin", ["branch_admin", "finance_head"], true)).toBe(false);
    expect(hasGlobalFinanceScope("accounts_head", ["accounts_head"], true)).toBe(false);
  });

  it("leaves true global roles (super_admin, ceo) global even with excludeStageRoles", async () => {
    const { hasGlobalFinanceScope } = await import("../finance-access-scope.js");
    expect(hasGlobalFinanceScope("super_admin", ["super_admin"], true)).toBe(true);
    expect(hasGlobalFinanceScope("ceo", ["ceo"], true)).toBe(true);
  });

  it("pins a Finance Head + Branch Head to their own branch for the Branch Head bucket", async () => {
    const { assertFinanceRecordBranch } = await import("../finance-access-scope.js");
    await expect(
      assertFinanceRecordBranch({
        userId: "u1",
        primaryRole: "branch_head",
        userRoles: ["branch_head", "finance_head"],
        recordBranchId: "branch-someone-else",
        excludeStageRoles: true,
      }),
    ).rejects.toThrow(/cannot access a finance record from another branch/i);

    await expect(
      assertFinanceRecordBranch({
        userId: "u1",
        primaryRole: "branch_head",
        userRoles: ["branch_head", "finance_head"],
        recordBranchId: "branch-own",
        excludeStageRoles: true,
      }),
    ).resolves.toBeUndefined();
  });

  it("still lets the same Finance Head read every branch's GRN at their own (later) stage", async () => {
    // Same user, excludeStageRoles simply omitted — the accounts_head_approved/finance_head
    // bucket's call site never passes it.
    const { assertFinanceRecordBranch } = await import("../finance-access-scope.js");
    await expect(
      assertFinanceRecordBranch({
        userId: "u1",
        primaryRole: "branch_head",
        userRoles: ["branch_head", "finance_head"],
        recordBranchId: "branch-someone-else",
      }),
    ).resolves.toBeUndefined();
  });
});
