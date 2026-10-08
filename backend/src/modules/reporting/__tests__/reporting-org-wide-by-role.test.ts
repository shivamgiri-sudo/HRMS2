import { describe, it, expect, vi, beforeEach } from "vitest";

const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));

const { resolveBranchScope, resolveFullScope } = await import("../reporting.scope.js");

const USER_ID = "d98a0a9d-6d7b-4b1d-98a1-cc948fb09eea";
const OWN_BRANCH = "77769026-5e88-11f1-adb1-00155d0ab410";

/** Routes by SQL text, so the assertions do not depend on call order. */
function mockUser(roleKey: string, assignmentRows: Array<{ scope_type: string; branch_id: string | null }>) {
  dbExecute.mockImplementation(async (sql?: string) => {
    if (typeof sql !== "string") return [[]];
    if (sql.includes("FROM user_roles")) return [[{ role_key: roleKey }]];
    if (sql.includes("FROM employees")) return [[{ id: "e1", branch_id: OWN_BRANCH, process_id: null }]];
    if (sql.includes("FROM user_assignment_scope")) {
      return [assignmentRows.map((r) => ({ ...r, process_id: null, department_id: null, cost_centre_id: null }))];
    }
    return [[]];
  });
}

/**
 * Owner ruling 2026-10-01: payroll_head, finance_head, accounts_head, finance, coo, cfo and department
 * heads are all-branch BY ROLE (scopeAccess.isOrgWideUser). report scope used to ALSO require a
 * scope_type='all' assignment row, so a payroll_head without one was clamped to a single branch.
 */
describe("report scope: org-wide roles are all-branch by role", () => {
  beforeEach(() => dbExecute.mockReset());

  it.each(["payroll_head", "finance_head", "accounts_head", "finance", "coo", "cfo"])(
    "%s with NO assignment rows sees every branch",
    async (role) => {
      mockUser(role, []);
      expect(await resolveBranchScope(USER_ID)).toEqual({ isSuperAdmin: false, branchIds: [] });
    },
  );

  it("a payroll_head with only a branch-narrowing row is still all-branch (rows never narrow an org-wide role here)", async () => {
    mockUser("payroll_head", [{ scope_type: "branch", branch_id: "some-other-branch" }]);
    expect(await resolveBranchScope(USER_ID)).toEqual({ isSuperAdmin: false, branchIds: [] });
  });

  it("resolveFullScope gives a payroll_head with no assignment rows an unrestricted branch dimension", async () => {
    mockUser("payroll_head", []);
    const scope = await resolveFullScope(USER_ID);
    expect(scope.branchScope.mode).toBe("all");
  });
});

describe("report scope: admin and other non-org-wide roles stay clamped", () => {
  beforeEach(() => dbExecute.mockReset());

  it("admin holding an 'all' assignment row is still limited to their own branch (rows never widen)", async () => {
    mockUser("admin", [{ scope_type: "all", branch_id: null }]);
    const scope = await resolveBranchScope(USER_ID);
    expect(scope.isSuperAdmin).toBe(false);
    expect(scope.branchIds).toEqual([OWN_BRANCH]);
  });

  it("admin with an 'all' row has a restricted branch dimension in resolveFullScope", async () => {
    mockUser("admin", [{ scope_type: "all", branch_id: null }]);
    const scope = await resolveFullScope(USER_ID);
    expect(scope.branchScope).toEqual({ mode: "restricted", ids: [OWN_BRANCH] });
  });

  it("super_admin remains unrestricted", async () => {
    mockUser("super_admin", []);
    expect(await resolveBranchScope(USER_ID)).toEqual({ isSuperAdmin: true, branchIds: [] });
  });
});
