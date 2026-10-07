import { beforeEach, describe, expect, it, vi } from "vitest";

/** A Branch Head reads a Head Office GRN that landed on their branch (read-only) and nothing else. */
const { execute, assertRecordBranch } = vi.hoisted(() => ({ execute: vi.fn(), assertRecordBranch: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../grn-head-office-bypass.js", () => ({ isHeadOfficeBranch: vi.fn() }));
vi.mock("../finance-access-scope.js", () => ({ assertFinanceRecordBranch: assertRecordBranch }));

import { assertGrnReadAccess, grnBranchVisibility } from "../grn-branch-split.js";

const who = { userId: "u", primaryRole: "branch_head", userRoles: ["branch_head"] };

beforeEach(() => {
  execute.mockReset();
  // The caller's scope is branch br-A only.
  assertRecordBranch.mockReset().mockImplementation(async ({ recordBranchId }: { recordBranchId: string }) => {
    if (recordBranchId !== "br-A") throw new Error("You cannot access a finance record from another branch");
  });
});

describe("list visibility SQL", () => {
  it("company scope is unfiltered; a branch scope also matches Head Office GRNs with a share on it", () => {
    expect(grnBranchVisibility({ mode: "all" })).toEqual({ sql: "1=1", params: [] });
    const v = grnBranchVisibility({ mode: "branches", branchIds: ["br-A", "br-B"] }, "g");
    expect(v.sql).toContain("g.branch_id IN (?, ?)");
    expect(v.sql).toContain("sa.branch_id <> g.branch_id");
    expect(v.sql).toContain("sa.branch_id IN (?, ?)");
    expect(v.params).toEqual(["br-A", "br-B", "br-A", "br-B"]);
    // Needs no new column, so it is safe before migration 2121 has run.
    expect(v.sql).not.toContain("is_branch_split");
  });
});

describe("read access to one GRN", () => {
  it("the owning branch reads it all (no share restriction)", async () => {
    await expect(assertGrnReadAccess({ ...who, grnId: "g1", headerBranchId: "br-A" })).resolves.toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  it("a Head Office GRN with a share on the caller's branch is readable, limited to that branch's share", async () => {
    execute.mockResolvedValue([[{ branch_id: "br-A" }, { branch_id: "br-B" }], []]);
    await expect(assertGrnReadAccess({ ...who, grnId: "g1", headerBranchId: "ho" })).resolves.toEqual(["br-A"]);
  });

  it("a Head Office GRN with no share on the caller's branch stays refused with the original error", async () => {
    execute.mockResolvedValue([[{ branch_id: "br-B" }], []]);
    await expect(assertGrnReadAccess({ ...who, grnId: "g1", headerBranchId: "ho" })).rejects.toThrow(/another branch/);
    execute.mockResolvedValue([[], []]);
    await expect(assertGrnReadAccess({ ...who, grnId: "g1", headerBranchId: "ho" })).rejects.toThrow(/another branch/);
  });
});
