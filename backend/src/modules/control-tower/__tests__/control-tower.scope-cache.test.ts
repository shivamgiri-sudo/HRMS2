import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  execute: vi.fn(),
  roles: vi.fn(),
  emp: vi.fn(),
  scopes: vi.fn(),
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: m.execute } }));
vi.mock("../../../shared/accessGuard.js", () => ({ getEmployeeForUser: m.emp }));
vi.mock("../../../shared/scopeAccess.js", () => ({ getUserRoleKeys: m.roles, getUserAssignmentScopes: m.scopes, ORG_WIDE_EXEMPT_ROLES: ["super_admin", "admin", "ceo", "coo", "cfo", "payroll_head", "finance_head", "accounts_head", "finance"] }));
vi.mock("../../../shared/dbHelpers.js", () => ({ tableExists: vi.fn(async () => true) }));

import {
  canSeeScope,
  controlTowerService,
  newScopeCtx,
} from "../control-tower.service.js";

describe("control-tower scope cache", () => {
  beforeEach(() => {
    Object.values(m).forEach((f) => f.mockReset());
    m.roles.mockResolvedValue(["manager"]);
    m.emp.mockResolvedValue({ id: "e1", employee_code: "C1" });
    m.scopes.mockResolvedValue([{ scope_type: "branch", branch_id: "b1" }]);
  });

  it("resolves roles/employee/scopes once across many rows and keeps decisions identical", async () => {
    const ctx = newScopeCtx();
    const rows = [
      { branch_id: "b1" },
      { branch_id: "b2" },
      { branch_id: "b1" },
      { assigned_user_id: "u1" },
    ];
    const cached = [];
    for (const r of rows) cached.push(await canSeeScope("u1", r, ctx));
    expect(cached).toEqual([true, false, true, true]);
    expect(m.roles).toHaveBeenCalledTimes(1);
    expect(m.emp).toHaveBeenCalledTimes(1);
    expect(m.scopes).toHaveBeenCalledTimes(1);

    m.roles.mockClear();
    const uncached = [];
    for (const r of rows) uncached.push(await canSeeScope("u1", r));
    expect(uncached).toEqual(cached);
    expect(m.roles).toHaveBeenCalledTimes(rows.length);
  });

  it("listEvents uses one lookup set per request", async () => {
    m.execute.mockResolvedValueOnce([
      [{ branch_id: "b1" }, { branch_id: "b1" }, { branch_id: "b2" }],
      [],
    ]);
    const out = await controlTowerService.listEvents({}, "u1");
    expect(out).toHaveLength(2);
    expect(m.roles).toHaveBeenCalledTimes(1);
    expect(m.scopes).toHaveBeenCalledTimes(1);
  });
});
