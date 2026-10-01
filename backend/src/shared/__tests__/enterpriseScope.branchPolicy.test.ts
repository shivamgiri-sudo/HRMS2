import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Branch-scoping policy (owner ruling 2026-10-01):
 *   - hr, payroll_hr, reporting managers and branch roles: their own branch / assignments only
 *   - finance, payroll_head, finance_head, accounts_head (plus super_admin, ceo...): all branches
 *   - admin: own branch only (owner ruling 2026-10-01, later)
 * enterpriseScope.ts used to wave hr, payroll and finance through and to honour scope_type='all'
 * for every role, which contradicted scopeAccess.ts (an 'all' grant is downgraded to the user's
 * own branch for non-exempt roles).
 */
const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));
vi.mock("../../db/mysql.js", () => ({ db: { execute: dbExecute } }));
vi.mock("../demoAuth.js", () => ({ demoRoleForUserId: () => null }));
vi.mock("../requestContext.js", () => ({ memoizeForRequest: (_k: string, fn: () => unknown) => fn() }));

const {
  buildEmployeeScopeCondition, buildProcessScopeCondition, canViewEmployee, canViewPayroll,
  canViewSensitiveEmployeeData, canViewGrievance, resolveUserBusinessScope,
} = await import("../enterpriseScope.js");

const BRANCH_A = "branch-a";
const BRANCH_B = "branch-b";

/** Mocks the three queries resolveUserBusinessScope issues, plus the employee lookup. */
function asUser(opts: {
  roles: string[];
  branchId?: string | null;
  assignments?: Array<Record<string, unknown>>;
  employees?: Record<string, { branch_id: string | null }>;
}) {
  dbExecute.mockReset();
  dbExecute.mockImplementation(async (sql: string, params: unknown[]) => {
    if (/FROM user_roles/.test(sql)) return [opts.roles.map((role_key) => ({ role_key })), []];
    if (/FROM user_assignment_scope/.test(sql)) return [opts.assignments ?? [], []];
    if (/FROM employees\s+WHERE user_id/.test(sql)) {
      return [opts.branchId === undefined ? [] : [{ id: "emp-self", employee_code: "E1", branch_id: opts.branchId }], []];
    }
    if (/FROM employees\s+WHERE id = \?/.test(sql)) {
      const e = opts.employees?.[String(params[0])];
      return [e ? [{ id: params[0], branch_id: e.branch_id }] : [], []];
    }
    return [[], []];
  });
}
const ALIAS = { employeeId: "e.id", branchId: "e.branch_id" };

beforeEach(() => dbExecute.mockReset());

describe("who is org-wide", () => {
  it.each(["finance", "payroll_head", "finance_head", "accounts_head", "super_admin", "ceo"])(
    "%s sees every branch",
    async (role) => {
      asUser({ roles: [role], branchId: BRANCH_A });
      const scope = await resolveUserBusinessScope("u1");
      expect(buildEmployeeScopeCondition(scope, ALIAS).sql).toBe("1=1");
      expect(buildProcessScopeCondition(scope, { branchId: "p.branch_id" }).sql).toBe("1=1");
      await expect(canViewPayroll("u1", "someone-else")).resolves.toBe(true);
    },
  );

  it.each(["hr", "payroll_hr", "manager", "branch_head", "admin"])("%s is NOT org-wide", async (role) => {
    asUser({ roles: [role], branchId: BRANCH_A, assignments: role === "admin" ? [] : [{ role_key: role, scope_type: "branch", branch_id: BRANCH_A }] });
    const scope = await resolveUserBusinessScope("u1");
    const cond = buildEmployeeScopeCondition(scope, ALIAS);
    expect(cond.sql).not.toBe("1=1");
    expect(cond.params).toContain(BRANCH_A);
    expect(buildProcessScopeCondition(scope, { branchId: "p.branch_id" }).sql).not.toBe("1=1");
  });
});

describe("hr is limited to its own branch", () => {
  const hr = (extra: Record<string, unknown> = {}) => ({
    roles: ["hr"], branchId: BRANCH_A,
    assignments: [{ role_key: "hr", scope_type: "branch", branch_id: BRANCH_A }],
    employees: { "in-a": { branch_id: BRANCH_A }, "in-b": { branch_id: BRANCH_B } },
    ...extra,
  });

  it("can view an employee in its branch but not in another", async () => {
    asUser(hr());
    await expect(canViewEmployee("u1", "in-a")).resolves.toBe(true);
    asUser(hr());
    await expect(canViewEmployee("u1", "in-b")).resolves.toBe(false);
  });

  it("an 'all' assignment on hr is downgraded to the hr user's own branch", async () => {
    const opts = hr({ assignments: [{ role_key: "hr", scope_type: "all" }] });
    asUser(opts);
    const scope = await resolveUserBusinessScope("u1");
    const cond = buildEmployeeScopeCondition(scope, ALIAS);
    expect(cond.sql).not.toContain("1=1");
    expect(cond.params).toContain(BRANCH_A);
    asUser(opts);
    await expect(canViewEmployee("u1", "in-b")).resolves.toBe(false);
    asUser(opts);
    await expect(canViewEmployee("u1", "in-a")).resolves.toBe(true);
  });

  it("an 'all' assignment on an org-wide role is still honoured", async () => {
    asUser({ roles: ["finance"], branchId: BRANCH_A, assignments: [{ role_key: "finance", scope_type: "all" }], employees: { "in-b": { branch_id: BRANCH_B } } });
    await expect(canViewEmployee("u1", "in-b")).resolves.toBe(true);
  });

  it("sees PAN / bank (sensitive) data only inside its branch", async () => {
    asUser(hr());
    await expect(canViewSensitiveEmployeeData("u1", "in-a")).resolves.toBe(true);
    asUser(hr());
    await expect(canViewSensitiveEmployeeData("u1", "in-b")).resolves.toBe(false);
  });

  it("handles grievances only for employees in its branch", async () => {
    asUser(hr());
    await expect(canViewGrievance("u1", { employee_id: "in-a", is_anonymous: 0 })).resolves.toBe(true);
    asUser(hr());
    await expect(canViewGrievance("u1", { employee_id: "in-b", is_anonymous: 0 })).resolves.toBe(false);
  });

  it("payroll_hr cannot read another branch's payroll", async () => {
    asUser({ roles: ["payroll_hr"], branchId: BRANCH_A, assignments: [{ role_key: "payroll_hr", scope_type: "branch", branch_id: BRANCH_A }] });
    await expect(canViewPayroll("u1", "in-b")).resolves.toBe(false);
  });

  it("an hr user with no assignments and no 'all' grant sees nothing but themselves (fails closed)", async () => {
    asUser({ roles: ["hr"], branchId: BRANCH_A, assignments: [] });
    const scope = await resolveUserBusinessScope("u1");
    const cond = buildEmployeeScopeCondition(scope, ALIAS);
    expect(cond.sql).toBe("e.id = ?");
    expect(cond.params).toEqual(["emp-self"]);
  });
});
