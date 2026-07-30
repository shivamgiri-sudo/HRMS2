import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Head office sees every branch; anyone assigned to a branch sees only that branch.
 *
 * This guards a leak found by logging in as a real branch-assigned HR user. She held an
 * explicit user_assignment_scope row (role_key='hr', scope_type='branch', one branch) and
 * still resolved to ORG_ALL — seeing full org headcount, all 1,493 attendance exceptions
 * and all 16,857 recruiter leads, identically to super admin.
 *
 * Cause: resolveDashboardScope returned ORG_ALL for any role in ORG_ALL_ROLES *before*
 * assignment scopes were loaded, which made the guard below it unreachable dead code.
 * 15 users were affected. Three of them were branch heads who also hold `hr`; because
 * `hr` (priority 90) outranks `branch_head`, they were elevated too — defeating exactly
 * the protection BRANCH_ALL_ROLES exists to provide.
 *
 * The decision must rest on an explicit assignment row and NOT on employees.branch_id:
 * head-office staff are themselves employees of some branch, so keying off the employee
 * record would narrow every HO user to their own office.
 */

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

// getUserRoleContext must be mocked, not getUserRoleKeys: it calls getUserRoleKeys
// through the module's own internal binding, which a partial mock does not replace.
// resolvePrimaryRole is kept real so the tests exercise the actual ROLE_PRIORITY
// ordering — that ordering is what elevated `hr` over `branch_head` in the leak.
const { getUserRoleContext } = vi.hoisted(() => ({ getUserRoleContext: vi.fn() }));
vi.mock("../../../shared/roleResolver.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../shared/roleResolver.js")>();
  return { ...actual, getUserRoleContext };
});

import { resolvePrimaryRole } from "../../../shared/roleResolver.js";

/** Builds the context resolveDashboardScope reads, using the real priority ordering. */
function withRoles(roleKeys: string[]) {
  const primaryRole = resolvePrimaryRole(roleKeys);
  getUserRoleContext.mockResolvedValue({
    roleKeys,
    primaryRole,
    isSuperAdmin: roleKeys.includes("super_admin") || roleKeys.includes("admin"),
    isHO: roleKeys.some((r) => r.startsWith("ho_") || ["ceo", "coo", "management"].includes(r)),
  });
  return primaryRole;
}

import { resolveDashboardScope } from "../../../shared/dashboardScope.js";

type ScopeRow = {
  role_key: string;
  scope_type: string;
  branch_id: string | null;
  process_id: string | null;
  manager_employee_id: string | null;
};

/**
 * Wires the two reads resolveDashboardScope makes: user_assignment_scope, then the
 * employee record. `employeeBranchId` is set on every case on purpose — it is what the
 * old logic would have keyed off, so leaving it populated keeps the test honest.
 */
function wireDb(assignments: ScopeRow[], employeeBranchId = "branch-own-office") {
  execute.mockReset();
  execute.mockImplementation(async (sql: string) => {
    if (sql.includes("user_assignment_scope")) return [assignments, []];
    if (sql.includes("FROM employees") && sql.includes("user_id")) {
      return [[{ id: "emp-1", branch_id: employeeBranchId, process_id: null }], []];
    }
    // branchesForProcesses
    if (sql.includes("SELECT DISTINCT branch_id")) return [[{ branch_id: "branch-from-process" }], []];
    return [[], []];
  });
}

const row = (over: Partial<ScopeRow> = {}): ScopeRow => ({
  role_key: "hr",
  scope_type: "branch",
  branch_id: "branch-noida-2",
  process_id: null,
  manager_employee_id: null,
  ...over,
});

describe("head office vs branch scope", () => {
  beforeEach(() => {
    execute.mockReset();
    getUserRoleContext.mockReset();
  });

  it("scopes an HR user with an explicit branch assignment to that branch only", async () => {
    withRoles(["employee", "hr", "interviewer", "recruiter"]);
    wireDb([row()]);

    const scope = await resolveDashboardScope("user-sofiya", "hr");

    expect(scope.level, "an explicitly branch-assigned HR user must not be ORG_ALL").toBe("BRANCH_ALL");
    expect(scope.branchIds).toEqual(["branch-noida-2"]);
    // The assignment is the grant: their own office must not widen it.
    expect(scope.branchIds).not.toContain("branch-own-office");
  });

  it("gives an HR user with no branch or process assignment the whole org", async () => {
    withRoles(["employee", "hr"]);
    wireDb([]);

    const scope = await resolveDashboardScope("user-ho-hr", "hr");

    expect(scope.level, "head-office HR has no branch assignment and sees every branch").toBe("ORG_ALL");
    expect(scope.branchIds).toEqual([]);
  });

  it("treats an explicit scope_type='all' row as head office", async () => {
    withRoles(["employee", "hr"]);
    wireDb([row({ scope_type: "all", branch_id: null })]);

    const scope = await resolveDashboardScope("user-ho-explicit", "hr");

    expect(scope.level).toBe("ORG_ALL");
  });

  it("does not let a higher-priority org-wide role override a branch head's assignment", async () => {
    // `hr` is priority 90 and outranks branch_head, so the primary role is `hr`. Three
    // real users are in exactly this state; before the fix all three saw the whole company.
    withRoles(["branch_head", "employee", "hr"]);
    wireDb([row({ role_key: "branch_head" })]);

    const scope = await resolveDashboardScope("user-branch-head", "hr");

    expect(scope.level).toBe("BRANCH_ALL");
    expect(scope.branchIds).toEqual(["branch-noida-2"]);
  });

  it("scopes to process when the assignment names a process", async () => {
    withRoles(["employee", "hr"]);
    wireDb([row({ scope_type: "process", branch_id: null, process_id: "process-back-office" })]);

    const scope = await resolveDashboardScope("user-process-hr", "hr");

    expect(scope.level).toBe("PROCESS_ALL");
    expect(scope.processIds).toEqual(["process-back-office"]);
  });

  it("keeps super_admin org-wide even with a stray branch assignment row", async () => {
    // Narrowing a system administrator could lock them out of the platform entirely.
    withRoles(["super_admin", "employee"]);
    wireDb([row({ role_key: "super_admin" })]);

    const scope = await resolveDashboardScope("user-super", "super_admin");

    expect(scope.level).toBe("ORG_ALL");
    expect(scope.branchIds).toEqual([]);
  });
});
