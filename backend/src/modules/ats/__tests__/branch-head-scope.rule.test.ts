import { describe, it, expect, vi, beforeEach } from "vitest";

const roleKeys = vi.fn();
const dbExecute = vi.fn();
vi.mock("../../../db/mysql.js", () => ({ db: { execute: (...a: unknown[]) => dbExecute(...a) } }));
vi.mock("../../../shared/scopeAccess.js", async () => {
  const actual = await vi.importActual<typeof import("../../../shared/scopeAccess.js")>("../../../shared/scopeAccess.js");
  return { ...actual, getUserRoleKeys: (...a: unknown[]) => roleKeys(...a), getUserAssignmentScopes: async () => [{ branch_id: "b-own" }] };
});

import { resolveBranchHeadScope } from "../branch-head-scope.js";

beforeEach(() => {
  dbExecute.mockReset();
  dbExecute.mockResolvedValue([[{ id: "emp-1", branch_id: "b-own" }]]);
});

describe("offer-approval scope (ruling 2026-10-15)", () => {
  it("a branch head who also holds an org-wide role stays on their own branch", async () => {
    roleKeys.mockResolvedValue(["branch_head", "hr_head"]);
    const s = await resolveBranchHeadScope("u1");
    expect(s.unrestricted).toBe(false);
    expect(s.branchIds).toEqual(["b-own"]);
  });
  it("super_admin is unrestricted", async () => {
    roleKeys.mockResolvedValue(["super_admin", "branch_head"]);
    expect((await resolveBranchHeadScope("u1")).unrestricted).toBe(true);
  });
  it("a non-branch-head org-wide role keeps full visibility (read-only queue)", async () => {
    roleKeys.mockResolvedValue(["ceo"]);
    expect((await resolveBranchHeadScope("u1")).unrestricted).toBe(true);
  });
});
