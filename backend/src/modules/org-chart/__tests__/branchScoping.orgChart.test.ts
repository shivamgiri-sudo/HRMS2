import { beforeEach, describe, expect, it, vi } from "vitest";

/** Org chart (owner ruling 2026-10-01): hr is branch-scoped, company scope is for the org-wide roles only. */
const { dbExecute } = vi.hoisted(() => ({ dbExecute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));
const { resolveUserOrgContext, buildScopeWhereClause, assertScopeAccess } = await import("../org-chart.scope.js");

function mockUser(roles: string[], emp: Record<string, string> | null = { id: "e1", branch_id: "b1", process_id: "p1", branch_name: "B", process_name: "P" }) {
  dbExecute.mockReset();
  dbExecute.mockImplementation(async (sql: string) => {
    if (/FROM user_roles/.test(sql)) return [roles.map((role_key) => ({ role_key })), []];
    if (/FROM employees e\s+LEFT JOIN branch_master/.test(sql)) return [emp ? [emp] : [], []];
    return [[{ cnt: 3, reporting_manager_id: null }], []];
  });
}

beforeEach(() => dbExecute.mockReset());

describe("org-chart scopes", () => {
  it("hr gets no company-wide scope, only its own branch", async () => {
    mockUser(["hr"]);
    const ctx = await resolveUserOrgContext("u");
    expect(ctx.availableScopes.map((s) => s.scopeType)).not.toContain("company");
    expect(ctx.availableScopes.map((s) => s.scopeType)).toContain("branch");
    expect(ctx.defaultScope).toBe("branch");
    await expect(assertScopeAccess("u", "company")).rejects.toMatchObject({ statusCode: 403 });
  });
  it("ceo / super_admin keep the company scope", async () => {
    for (const r of ["ceo", "super_admin"]) {
      mockUser([r]);
      expect((await resolveUserOrgContext("u")).availableScopes.map((s) => s.scopeType)).toContain("company");
    }
  });
  it("admin is branch-scoped like hr: no company scope, own branch only (owner ruling 2026-10-01)", async () => {
    mockUser(["admin"]);
    const ctx = await resolveUserOrgContext("u");
    expect(ctx.availableScopes.map((s) => s.scopeType)).not.toContain("company");
    expect(ctx.availableScopes.map((s) => s.scopeType)).toContain("branch");
    await expect(assertScopeAccess("u", "company")).rejects.toMatchObject({ statusCode: 403 });
    expect(buildScopeWhereClause(ctx, "branch", { branchId: "other" }).sql).toContain("1=0");
  });
  it("a foreign ?branch_id cannot widen the branch scope for hr (fails closed)", async () => {
    mockUser(["hr"]);
    const ctx = await resolveUserOrgContext("u");
    const w = buildScopeWhereClause(ctx, "branch", { branchId: "other" });
    expect(w.sql).toContain("1=0");
    const own = buildScopeWhereClause(ctx, "branch", {});
    expect(own.params).toContain("b1");
  });
  it("org-wide callers may filter any branch", async () => {
    mockUser(["super_admin"]);
    const ctx = await resolveUserOrgContext("u");
    const w = buildScopeWhereClause(ctx, "branch", { branchId: "other" });
    expect(w.params).toContain("other");
    expect(w.sql).not.toContain("1=0");
  });
  it("process scope is bound to own branch for non-org-wide roles", async () => {
    mockUser(["process_manager"]);
    const ctx = await resolveUserOrgContext("u");
    const w = buildScopeWhereClause(ctx, "process", {});
    expect(w.params).toEqual(expect.arrayContaining(["p1", "b1"]));
  });
});
