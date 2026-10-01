import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Own-branch clamp (owner ruling 2026-10-01): outside the org-wide roles, a user only ever sees the
 * branch on their own employees record - extra branch / process / team assignment rows can narrow
 * further but never reach into another branch.
 */
const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));
vi.mock("../../db/mysql.js", () => ({ db: { execute: dbExecute } }));
vi.mock("../demoAuth.js", () => ({ demoRoleForUserId: () => null }));
vi.mock("../requestContext.js", () => ({ memoizeForRequest: (_k: string, fn: () => unknown) => fn() }));

const { buildScopeWhereClause, hasScopedAccess, isOrgWideUser } = await import("../scopeAccess.js");

const OWN = "branch-own";
const OTHER = "branch-other";
const ALIASES = { branchId: "e.branch_id", processId: "e.process_id" };

function asUser(o: { roles: string[]; ownBranch: string | null; scopes?: Array<Record<string, unknown>> }) {
  dbExecute.mockImplementation(async (sql: unknown) => {
    const t = String(sql);
    if (/FROM user_roles/i.test(t)) return [o.roles.map((role_key) => ({ role_key })), []];
    if (/FROM user_assignment_scope/i.test(t)) {
      return [(o.scopes ?? []).map((s, i) => ({ id: `s${i}`, process_id: null, lob_id: null, department_id: null, manager_employee_id: null, branch_id: null, ...s })), []];
    }
    if (/FROM employees WHERE user_id/i.test(t)) return [o.ownBranch ? [{ branch_id: o.ownBranch }] : [], []];
    return [[], []];
  });
}
beforeEach(() => dbExecute.mockReset());

describe("buildScopeWhereClause own-branch clamp", () => {
  it("hr with a grant on a second branch still only gets own branch", async () => {
    asUser({ roles: ["hr"], ownBranch: OWN, scopes: [{ role_key: "hr", scope_type: "branch", branch_id: OWN }, { role_key: "hr", scope_type: "branch", branch_id: OTHER }] });
    const r = await buildScopeWhereClause("u", ["hr"], ALIASES, { blockOrgWideForRoles: ["hr"] });
    expect(r.sql).toMatch(/AND e\.branch_id = \?$/);
    expect(r.params[r.params.length - 1]).toBe(OWN);
  });
  it("a process grant cannot cross branches", async () => {
    asUser({ roles: ["process_manager"], ownBranch: OWN, scopes: [{ role_key: "process_manager", scope_type: "process", process_id: "p1" }] });
    const r = await buildScopeWhereClause("u", ["process_manager"], ALIASES);
    expect(r.sql).toContain("e.process_id = ?");
    expect(r.sql).toMatch(/AND e\.branch_id = \?$/);
    expect(r.params).toContain(OWN);
  });
  it("no own branch (account not linked to an employee): the explicit branch grant decides", async () => {
    asUser({ roles: ["hr"], ownBranch: null, scopes: [{ role_key: "hr", scope_type: "branch", branch_id: OTHER }] });
    const r = await buildScopeWhereClause("u", ["hr"], ALIASES);
    expect(r.sql).toBe("e.branch_id = ?");
    expect(r.params).toEqual([OTHER]);
  });
  it.each(["finance", "payroll_head", "ceo", "super_admin"])("%s is not clamped", async (role) => {
    asUser({ roles: [role], ownBranch: OWN, scopes: [{ role_key: role, scope_type: "all" }] });
    const r = await buildScopeWhereClause("u", [role, "hr"], ALIASES, { allowCeoAllRead: true });
    expect(r.sql).not.toContain("branch_id = ?");
  });
});

describe("hasScopedAccess own-branch clamp", () => {
  it("denies a branch the user only holds an assignment for", async () => {
    asUser({ roles: ["hr"], ownBranch: OWN, scopes: [{ role_key: "hr", scope_type: "branch", branch_id: OTHER }] });
    await expect(hasScopedAccess("u", ["hr"], { branchId: OTHER })).resolves.toBe(false);
  });
  it("allows the own branch", async () => {
    asUser({ roles: ["hr"], ownBranch: OWN, scopes: [{ role_key: "hr", scope_type: "branch", branch_id: OWN }] });
    await expect(hasScopedAccess("u", ["hr"], { branchId: OWN })).resolves.toBe(true);
  });
  it("org-wide roles are not clamped", async () => {
    asUser({ roles: ["finance"], ownBranch: OWN, scopes: [{ role_key: "finance", scope_type: "all" }] });
    await expect(hasScopedAccess("u", ["finance"], { branchId: OTHER })).resolves.toBe(true);
  });
});

describe("isOrgWideUser", () => {
  it.each([["super_admin", true], ["ceo", true], ["finance", true], ["admin", false], ["hr", false], ["manager", false]])(
    "%s -> %s",
    async (role, expected) => {
      asUser({ roles: [role as string], ownBranch: OWN });
      await expect(isOrgWideUser("u")).resolves.toBe(expected);
    },
  );
});
