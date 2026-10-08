import { beforeEach, describe, expect, it, vi } from "vitest";

const { hasRole, canViewEmployee, dbExecute } = vi.hoisted(() => ({
  hasRole: vi.fn(async () => false), canViewEmployee: vi.fn(async () => false), dbExecute: vi.fn(),
}));
// hasRole(true) now stands for "holds the real dpo role"; admin is no longer a wildcard here (owner policy 2026-10-01).
const { orgWide } = vi.hoisted(() => ({ orgWide: vi.fn(async () => false) }));
vi.mock("../../../shared/scopeAccess.js", () => ({
  getUserRoleKeys: async () => ((await hasRole()) ? ["dpo"] : ["hr"]),
  isOrgWideUser: orgWide,
}));
vi.mock("../../../shared/enterpriseScope.js", () => ({ canViewEmployee, buildEmployeeScopeCondition: vi.fn(), resolveUserBusinessScope: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));
import { withdrawalDecideGuard, withdrawalScopeGuard } from "../dpdp-withdrawal.scope.js";

const run = async () => {
  const next = vi.fn(); const json = vi.fn(); const res: any = { status: vi.fn(() => ({ json })) };
  await withdrawalScopeGuard({ authUser: { id: "u-hr" }, params: { id: "w1" } } as any, res, next);
  return { next, res, json };
};
beforeEach(() => { vi.clearAllMocks(); orgWide.mockResolvedValue(false); hasRole.mockResolvedValue(false); canViewEmployee.mockResolvedValue(false); });

describe("withdrawalScopeGuard", () => {
  it("dpo passes without lookups", async () => {
    hasRole.mockResolvedValue(true);
    const { next } = await run();
    expect(next).toHaveBeenCalledWith(); expect(dbExecute).not.toHaveBeenCalled();
  });
  it("hr is refused for a request from an employee outside scope", async () => {
    dbExecute.mockResolvedValueOnce([[{ requester_id: "u-x" }]]).mockResolvedValueOnce([[{ id: "emp-x" }]]);
    const { next, res } = await run();
    expect(res.status).toHaveBeenCalledWith(403); expect(next).not.toHaveBeenCalled();
  });
  it("hr is allowed when the requester employee is in scope", async () => {
    canViewEmployee.mockResolvedValue(true);
    dbExecute.mockResolvedValueOnce([[{ requester_id: "u-x" }]]).mockResolvedValueOnce([[{ id: "emp-x" }]]);
    const { next } = await run();
    expect(next).toHaveBeenCalledWith();
  });
  it("requester with no employee record fails closed for hr", async () => {
    dbExecute.mockResolvedValueOnce([[{ requester_id: "u-x" }]]).mockResolvedValueOnce([[]]);
    const { res } = await run();
    expect(res.status).toHaveBeenCalledWith(403);
  });
  it("unknown id falls through to the handler 404", async () => {
    dbExecute.mockResolvedValueOnce([[]]);
    const { next } = await run();
    expect(next).toHaveBeenCalledWith();
  });
});

describe("withdrawalDecideGuard (start-review / approve / reject)", () => {
  const decide = async () => {
    const next = vi.fn(); const json = vi.fn(); const res: any = { status: vi.fn(() => ({ json })) };
    await withdrawalDecideGuard({ authUser: { id: "u-admin" }, params: { id: "w1" } } as any, res, next);
    return { next, res };
  };
  // execute order for a branch-scoped caller: requester lookup, caller employee row, requester's employee branch.
  const sequence = (callerBranch: string | null, requesterBranch: string | null) => {
    dbExecute
      .mockResolvedValueOnce([[{ requester_id: "u-req" }]])
      .mockResolvedValueOnce([[{ id: "e-admin", branch_id: callerBranch }]])
      .mockResolvedValueOnce([requesterBranch ? [{ branch_id: requesterBranch }] : []]);
  };
  it("admin of ANOTHER branch is refused with 403", async () => {
    sequence("br-A", "br-B");
    const { next, res } = await decide();
    expect(res.status).toHaveBeenCalledWith(403); expect(next).not.toHaveBeenCalled();
  });
  it("admin of the SAME branch is allowed", async () => {
    sequence("br-A", "br-A");
    expect((await decide()).next).toHaveBeenCalledWith();
  });
  it("requester branch unknown fails closed", async () => {
    sequence("br-A", null);
    expect((await decide()).res.status).toHaveBeenCalledWith(403);
  });
  it("caller with no own branch fails closed", async () => {
    sequence(null, "br-A");
    expect((await decide()).res.status).toHaveBeenCalledWith(403);
  });
  it("real dpo is allowed without lookups", async () => {
    hasRole.mockResolvedValue(true);
    const { next } = await decide();
    expect(next).toHaveBeenCalledWith(); expect(dbExecute).not.toHaveBeenCalled();
  });
  it("org-wide role is allowed without lookups", async () => {
    orgWide.mockResolvedValue(true);
    const { next } = await decide();
    expect(next).toHaveBeenCalledWith(); expect(dbExecute).not.toHaveBeenCalled();
  });
});
