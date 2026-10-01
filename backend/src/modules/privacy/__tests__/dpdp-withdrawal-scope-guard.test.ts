import { beforeEach, describe, expect, it, vi } from "vitest";

const { hasRole, canViewEmployee, dbExecute } = vi.hoisted(() => ({
  hasRole: vi.fn(async () => false), canViewEmployee: vi.fn(async () => false), dbExecute: vi.fn(),
}));
vi.mock("../../../shared/accessGuard.js", () => ({ hasRole }));
vi.mock("../../../shared/enterpriseScope.js", () => ({ canViewEmployee, buildEmployeeScopeCondition: vi.fn(), resolveUserBusinessScope: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));
import { withdrawalScopeGuard } from "../dpdp-withdrawal.scope.js";

const run = async () => {
  const next = vi.fn(); const json = vi.fn(); const res: any = { status: vi.fn(() => ({ json })) };
  await withdrawalScopeGuard({ authUser: { id: "u-hr" }, params: { id: "w1" } } as any, res, next);
  return { next, res, json };
};
beforeEach(() => { vi.clearAllMocks(); hasRole.mockResolvedValue(false); canViewEmployee.mockResolvedValue(false); });

describe("withdrawalScopeGuard", () => {
  it("dpo/admin pass without lookups", async () => {
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
