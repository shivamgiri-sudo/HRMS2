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
import { normalizeDashboardRole } from "../../../shared/dashboardAccessRegistry.js";

/**
 * Builds the context resolveDashboardScope reads, using the real priority ordering.
 *
 * Roles are normalised through DASHBOARD_ROLE_ALIASES first, because that is what the real
 * getUserRoleKeys returns. Passing raw keys here made an earlier version of the
 * alias-matching test pass against broken code: the mismatch under test is precisely
 * normalised-held-role vs raw-scope-row-key, so a mock that skips normalisation cannot
 * reproduce it.
 */
function withRoles(roleKeys: string[]) {
  const normalized = Array.from(new Set(roleKeys.map((r) => normalizeDashboardRole(r))));
  const primaryRole = resolvePrimaryRole(normalized);
  getUserRoleContext.mockResolvedValue({
    roleKeys: normalized,
    primaryRole,
    isSuperAdmin: normalized.includes("super_admin") || normalized.includes("admin"),
    isHO: normalized.some((r) => r.startsWith("ho_") || ["ceo", "coo", "management"].includes(r)),
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

  it("fails closed for an ambiguous role with no assignment at all", async () => {
    // hr / payroll / finance are used for both head-office and branch staff, so no
    // assignment row is absence of evidence, not evidence of head office. Defaulting to
    // ORG_ALL meant one mis-provisioned `payroll` account would see every salary line in
    // the company. Head office must be stated explicitly.
    for (const role of ["hr", "payroll", "payroll_hr", "finance"]) {
      withRoles([role, "employee"]);
      wireDb([]);

      const scope = await resolveDashboardScope(`user-unprovisioned-${role}`, role);

      expect(scope.level, `${role} with no scope row must not open the whole org`).toBe("BRANCH_ALL");
      expect(scope.branchIds).toEqual(["branch-own-office"]);
    }
  });

  it("gives an ambiguous role the whole org only on an explicit all grant", async () => {
    withRoles(["employee", "hr"]);
    wireDb([row({ scope_type: "all", branch_id: null })]);

    const scope = await resolveDashboardScope("user-ho-hr", "hr");

    expect(scope.level, "an explicit scope_type='all' row is how head office is declared").toBe("ORG_ALL");
    expect(scope.branchIds).toEqual([]);
  });

  it("refuses rather than guessing when there is no assignment and no branch", async () => {
    // The E2E fixtures that exposed this have branch_id and process_id both NULL. Opening
    // the org for them would be the worst outcome; a clear error names what to configure.
    withRoles(["payroll", "employee"]);
    execute.mockReset();
    execute.mockImplementation(async (sql: string) => {
      if (sql.includes("user_assignment_scope")) return [[], []];
      if (sql.includes("FROM employees") && sql.includes("user_id")) {
        return [[{ id: "emp-1", branch_id: null, process_id: null }], []];
      }
      return [[], []];
    });

    await expect(resolveDashboardScope("user-no-branch", "payroll")).rejects.toThrow(
      /No active branch or scope_type='all' scope is configured/,
    );
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

  it("keeps head-office titles org-wide despite a head-office branch assignment", async () => {
    // Head office is itself a branch in branch_master — three of them (CORP, HQ,
    // HEAD_OFFICE), each ~12 employees. Narrowing by assignment alone scoped the real
    // CEO account (MAS00001) to the 13 people sitting at head office.
    for (const role of ["ceo", "coo", "management", "ho_hr", "operations_head", "finance_head"]) {
      withRoles([role, "employee"]);
      wireDb([row({ role_key: role, branch_id: "branch-head-office" })]);

      const scope = await resolveDashboardScope(`user-${role}`, role);

      expect(scope.level, `${role} is a head-office title and must stay org-wide`).toBe("ORG_ALL");
      expect(scope.branchIds).toEqual([]);
    }
  });

  it("keeps ambiguous head-office/branch titles narrowable", async () => {
    // These role keys are used for BOTH head-office and branch staff in this database, so
    // the assignment row is the only evidence of which a given user is. If any of them
    // were added to HEAD_OFFICE_ROLES the original leak would return for the 14 real
    // branch-assigned users who hold them.
    for (const role of ["hr", "hr_admin", "payroll", "payroll_hr", "payroll_admin", "finance"]) {
      withRoles([role, "employee"]);
      wireDb([row({ role_key: role })]);

      const scope = await resolveDashboardScope(`user-${role}`, role);

      expect(scope.level, `${role} is ambiguous and must narrow to its assigned branch`).toBe("BRANCH_ALL");
      expect(scope.branchIds).toEqual(["branch-noida-2"]);
    }
  });

  it("matches scope rows written in an alias role form", async () => {
    // getUserRoleKeys returns roles normalised through DASHBOARD_ROLE_ALIASES
    // (payroll_admin -> payroll, hr_branch -> branch_hr, tl -> team_leader, ...), but
    // user_assignment_scope.role_key stores whatever an administrator typed. Comparing a
    // normalised held role against a raw row key silently discarded the row.
    //
    // Live case: NARESH KUMAR CHAUHAN (MAS00175) holds payroll_admin + payroll_hr with two
    // scope_type='all' rows keyed payroll_admin / payroll_hr. Both normalise to `payroll`,
    // so neither matched and both grants vanished — which only became visible once a
    // missing grant correctly failed closed, at which point a head-office payroll
    // administrator would have been narrowed to the 13 people at Head Office.
    withRoles(["employee", "payroll_admin", "payroll_hr"]);
    wireDb([
      row({ role_key: "payroll_admin", scope_type: "all", branch_id: null }),
      row({ role_key: "payroll_hr", scope_type: "all", branch_id: null }),
    ]);

    const scope = await resolveDashboardScope("user-naresh", "payroll");

    expect(scope.level, "an 'all' grant keyed by an alias role must still be honoured").toBe("ORG_ALL");
    expect(scope.branchIds).toEqual([]);
  });

  it("still honours an alias-keyed NARROWING row", async () => {
    // The same normalisation must not accidentally widen anyone: a branch row written in
    // alias form has to narrow just as a canonical one does.
    withRoles(["employee", "payroll_admin"]);
    wireDb([row({ role_key: "payroll_admin", scope_type: "branch" })]);

    const scope = await resolveDashboardScope("user-branch-payroll", "payroll");

    expect(scope.level).toBe("BRANCH_ALL");
    expect(scope.branchIds).toEqual(["branch-noida-2"]);
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
