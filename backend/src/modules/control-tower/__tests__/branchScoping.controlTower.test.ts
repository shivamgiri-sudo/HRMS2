import { beforeEach, describe, expect, it, vi } from "vitest";

/** Control tower (owner ruling 2026-10-01): hr is no longer an org-wide shortcut. */
const m = vi.hoisted(() => ({ execute: vi.fn(), roles: vi.fn(), emp: vi.fn(), scopes: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: m.execute } }));
vi.mock("../../../shared/accessGuard.js", () => ({ getEmployeeForUser: m.emp }));
vi.mock("../../../shared/scopeAccess.js", () => ({
  getUserRoleKeys: m.roles, getUserAssignmentScopes: m.scopes,
  ORG_WIDE_EXEMPT_ROLES: ["super_admin", "admin", "ceo", "coo", "cfo", "payroll_head", "finance_head", "accounts_head", "finance"],
}));
vi.mock("../../../shared/dbHelpers.js", () => ({ tableExists: vi.fn(async () => true) }));

import { canSeeScope, controlTowerService } from "../control-tower.service.js";

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.emp.mockResolvedValue({ id: "e1", employee_code: "C1" });
  // employeeBranchId() -> own branch b1
  m.execute.mockImplementation(async (sql: string) => {
    if (/SELECT branch_id FROM employees WHERE id/.test(sql)) return [[{ branch_id: "b1" }], []];
    if (/information_schema\.columns/.test(sql)) return [["branch_id", "process_id", "user_id", "reporting_manager_id", "id"].map((column_name) => ({ column_name })), []];
    return [[{ c: 0 }], []];
  });
});

describe("canSeeScope", () => {
  it("hr with an 'all' grant sees only its own branch's items", async () => {
    m.roles.mockResolvedValue(["hr"]); m.scopes.mockResolvedValue([{ scope_type: "all" }]);
    expect(await canSeeScope("u1", { branch_id: "b1" })).toBe(true);
    expect(await canSeeScope("u1", { branch_id: "b2" })).toBe(false);
  });
  it("hr cannot read another branch's role-queue item (assigned_role=hr)", async () => {
    m.roles.mockResolvedValue(["hr"]); m.scopes.mockResolvedValue([{ scope_type: "all" }]);
    expect(await canSeeScope("u1", { branch_id: "b2", assigned_role: "hr" })).toBe(false);
    expect(await canSeeScope("u1", { branch_id: "b1", assigned_role: "hr" })).toBe(true);
  });
  it("admin and ceo stay org-wide", async () => {
    for (const r of ["admin", "ceo", "super_admin"]) {
      m.roles.mockResolvedValue([r]);
      expect(await canSeeScope("u1", { branch_id: "anything" })).toBe(true);
    }
  });
});

describe("master-data health scope", () => {
  it("hr is limited to its own branch (was 1=1); admin is unrestricted", async () => {
    m.roles.mockResolvedValue(["hr"]); m.scopes.mockResolvedValue([]);
    await controlTowerService.getMasterDataHealth("u1");
    const hrCalls = m.execute.mock.calls.filter(([sql]) => /SELECT COUNT\(\*\) AS c FROM employees e WHERE/.test(sql));
    expect(hrCalls.length).toBeGreaterThan(0);
    expect(hrCalls[0][0]).toMatch(/e\.branch_id = \?/);
    expect(hrCalls[0][1]).toContain("b1");
    m.execute.mockClear(); m.roles.mockResolvedValue(["admin"]);
    await controlTowerService.getMasterDataHealth("u1");
    const adminCalls = m.execute.mock.calls.filter(([sql]) => /SELECT COUNT\(\*\) AS c FROM employees e WHERE/.test(sql));
    expect(adminCalls[0][0]).toMatch(/WHERE 1=1 AND/);
  });
});

describe("manager team hierarchy", () => {
  it("opening another manager's team outside the caller's branch is refused", async () => {
    m.roles.mockResolvedValue(["branch_head"]); m.scopes.mockResolvedValue([{ scope_type: "branch", branch_id: "b1" }]);
    m.execute.mockImplementation(async (sql: string) => (/SELECT branch_id, process_id FROM employees/.test(sql) ? [[{ branch_id: "b2", process_id: "p" }], []] : [[], []]));
    await expect(controlTowerService.getManagerTeamHierarchy("u1", "mgr-b2")).rejects.toMatchObject({ statusCode: 403 });
  });
});
