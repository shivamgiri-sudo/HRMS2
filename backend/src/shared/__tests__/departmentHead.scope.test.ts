import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Owner ruling 2026-10-01: heads of ANY department see all branches.
 * Two ways to be one: a department-head role (it_head, tq_head, hr_head, operations_head ...), or being
 * named as the head of an ACTIVE department (department_master.dept_head_employee_id), which the role
 * lookup turns into the synthetic role `department_head`. branch_head is a BRANCH role and stays scoped.
 */
const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));
vi.mock("../../db/mysql.js", () => ({ db: { execute: dbExecute } }));
vi.mock("../demoAuth.js", () => ({ demoRoleForUserId: () => null }));
vi.mock("../requestContext.js", () => ({ memoizeForRequest: (_k: string, fn: () => unknown) => fn() }));

const sa = await import("../scopeAccess.js");
const es = await import("../enterpriseScope.js");

function asUser(roles: string[], opts: { branchId?: string | null } = {}) {
  dbExecute.mockReset();
  dbExecute.mockImplementation(async (sql: string) => {
    if (/FROM user_roles/.test(sql)) return [roles.map((role_key) => ({ role_key })), []];
    if (/FROM user_assignment_scope/.test(sql)) return [[], []];
    if (/FROM employees\s+WHERE user_id/.test(sql)) {
      return [opts.branchId === undefined ? [] : [{ id: "emp-self", employee_code: "E1", branch_id: opts.branchId }], []];
    }
    return [[], []];
  });
}
const ALIAS = { employeeId: "e.id", branchId: "e.branch_id" };

beforeEach(() => dbExecute.mockReset());

describe("which roles are all-branch", () => {
  it.each(["it_head", "tq_head", "hr_head", "operations_head", "security_head", "qa_head", "department_head"])(
    "%s is org-wide",
    (role) => {
      expect(sa.ORG_WIDE_EXEMPT_ROLES).toContain(role);
    },
  );

  it("branch_head and the other branch roles are NOT org-wide", () => {
    for (const r of ["branch_head", "hr", "payroll_hr", "admin", "manager", "process_manager", "wfm"]) {
      expect(sa.ORG_WIDE_EXEMPT_ROLES).not.toContain(r);
    }
  });

  it("the existing org-wide roles are unchanged", () => {
    for (const r of ["super_admin", "ceo", "coo", "cfo", "finance", "payroll_head", "finance_head", "accounts_head"]) {
      expect(sa.ORG_WIDE_EXEMPT_ROLES).toContain(r);
    }
  });
});

describe("a department head is all-branch in both scope helpers", () => {
  it("enterpriseScope: a role-based head sees every branch", async () => {
    asUser(["it_head"], { branchId: "branch-a" });
    const scope = await es.resolveUserBusinessScope("u1");
    expect(es.buildEmployeeScopeCondition(scope, ALIAS).sql).toBe("1=1");
    expect(es.buildProcessScopeCondition(scope, { branchId: "p.branch_id" }).sql).toBe("1=1");
  });

  it("enterpriseScope: someone named head of an active department (synthetic role) sees every branch", async () => {
    asUser(["employee", "department_head"], { branchId: "branch-a" });
    const scope = await es.resolveUserBusinessScope("u1");
    expect(scope.roles).toContain("department_head");
    expect(es.buildEmployeeScopeCondition(scope, ALIAS).sql).toBe("1=1");
  });

  it("enterpriseScope: branch_head is still limited to its branch", async () => {
    asUser(["branch_head"], { branchId: "branch-a" });
    const scope = await es.resolveUserBusinessScope("u1");
    expect(es.buildEmployeeScopeCondition(scope, ALIAS).sql).not.toBe("1=1");
  });

  it("scopeAccess: the role lookup returns the synthetic role for a named department head", async () => {
    asUser(["employee", "department_head"]);
    await expect(sa.getUserRoleKeys("u1")).resolves.toContain("department_head");
  });

  it("scopeAccess: a named department head with NO assignment row sees every branch (by role)", async () => {
    asUser(["hr", "department_head"], { branchId: "branch-a" }); // allowed role hr + synthetic head role, no rows
    const cond = await sa.buildScopeWhereClause("u1", ["hr"], { branchId: "e.branch_id" });
    expect(cond).toEqual({ sql: "1=1", params: [] });
    asUser(["hr", "department_head"], { branchId: "branch-a" });
    await expect(sa.hasScopedAccess("u1", ["hr"], { branchId: "branch-z" })).resolves.toBe(true);
  });

  it("scopeAccess: the same user WITHOUT the department-head role is limited to its own branch", async () => {
    asUser(["hr"], { branchId: "branch-a" });
    const cond = await sa.buildScopeWhereClause("u1", ["hr"], { branchId: "e.branch_id" });
    expect(cond.sql).toBe("1=0"); // no assignment rows and no org-wide role -> nothing
    asUser(["hr"], { branchId: "branch-a" });
    await expect(sa.hasScopedAccess("u1", ["hr"], { branchId: "branch-z" })).resolves.toBe(false);
  });
});

describe("the role lookup", () => {
  it("is ONE statement that also checks active department heads (query count unchanged)", async () => {
    asUser(["employee"]);
    await sa.getUserRoleKeys("u1");
    const roleQueries = dbExecute.mock.calls.filter(([sql]) => /FROM user_roles/.test(String(sql)));
    expect(roleQueries).toHaveLength(1);
    const [sql, params] = roleQueries[0] as [string, unknown[]];
    expect(sql).toMatch(/UNION/);
    expect(sql).toMatch(/department_master/);
    expect(sql).toMatch(/d\.active_status = 1/); // only ACTIVE departments count
    expect(params).toEqual(["u1", "u1"]);
  });
});
