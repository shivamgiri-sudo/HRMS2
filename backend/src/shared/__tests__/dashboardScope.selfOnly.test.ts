import { describe, it, expect, vi, beforeEach } from "vitest";

const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));
vi.mock("../../db/mysql.js", () => ({ db: { execute: dbExecute } }));

const { resolveDashboardScope, resolveSelfOnlyDashboardScope, DashboardScopeConfigurationError } =
  await import("../dashboardScope.js");

const USER_ID = "d98a0a9d-6d7b-4b1d-98a1-cc948fb09eea";
const EMPLOYEE_ID = "0cf00cf6-5e8b-11f1-adb1-00155d0ab410";
const BRANCH_ID = "77769026-5e88-11f1-adb1-00155d0ab410";
const PROCESS_ID = "7889a7ac-5e88-11f1-adb1-00155d0ab410";

/**
 * A branch_head calling with an employee row. Routes queries by SQL text rather than
 * call order — getUserRoleKeys issues several unconditional queries before
 * resolveEmployeeScope's own, so order is not a stable thing to assert on.
 */
function mockBranchHead() {
  dbExecute.mockImplementation(async (sql?: string) => {
    if (typeof sql !== "string") return [[]];
    if (sql.includes("FROM user_roles")) return [[{ role_key: "branch_head" }]];
    if (sql.includes("FROM user_assignment_scope")) return [[]];
    if (sql.includes("FROM employees")) {
      return [[{ id: EMPLOYEE_ID, branch_id: BRANCH_ID, process_id: PROCESS_ID }]];
    }
    return [[]];
  });
}

/**
 * EMPLOYEE_SELF_DASHBOARD's /summary route resolved scope through the exact same
 * requestedScope() as every operational dashboard, which builds scope from the caller's
 * ROLE via resolveDashboardScope — so a branch_head opening their own "My Dashboard" got
 * BRANCH_ALL, identical to what HR_DASHBOARD shows them, instead of their own record.
 *
 * resolveSelfOnlyDashboardScope is the fix: dashboard.routes.ts now calls it instead of
 * resolveDashboardScope whenever dashboardCode === "EMPLOYEE_SELF_DASHBOARD", regardless
 * of the caller's role. These tests prove the two genuinely disagree for the same caller
 * (the bug), and that the fix resolves to the caller alone.
 */
describe("resolveSelfOnlyDashboardScope", () => {
  beforeEach(() => dbExecute.mockReset());

  it("resolves a branch_head to their own employee record, not their branch", async () => {
    mockBranchHead();
    const scope = await resolveSelfOnlyDashboardScope(USER_ID);
    expect(scope.level).toBe("SELF_ONLY");
    expect(scope.employeeIds).toEqual([EMPLOYEE_ID]);
  });

  it("disagrees with resolveDashboardScope for the identical caller — this is the bug being fixed", async () => {
    mockBranchHead();
    const self = await resolveSelfOnlyDashboardScope(USER_ID);

    mockBranchHead();
    const roleBased = await resolveDashboardScope(USER_ID, "branch_head");

    expect(roleBased.level).toBe("BRANCH_ALL");
    expect(self.level).toBe("SELF_ONLY");
    expect(self.employeeIds).not.toEqual(roleBased.employeeIds);
  });

  it("fails closed, not org-wide, when the caller has no employee record", async () => {
    dbExecute.mockImplementation(async (sql?: string) => {
      if (typeof sql !== "string") return [[]];
      if (sql.includes("FROM user_roles")) return [[{ role_key: "admin" }]];
      if (sql.includes("FROM user_assignment_scope")) return [[]];
      if (sql.includes("FROM employees")) return [[]];
      return [[]];
    });
    await expect(resolveSelfOnlyDashboardScope(USER_ID)).rejects.toBeInstanceOf(
      DashboardScopeConfigurationError,
    );
  });

  it("carries the employee's own branch/process, not a widened list", async () => {
    mockBranchHead();
    const scope = await resolveSelfOnlyDashboardScope(USER_ID);
    expect(scope.branchIds).toEqual([BRANCH_ID]);
    expect(scope.processIds).toEqual([PROCESS_ID]);
  });
});
