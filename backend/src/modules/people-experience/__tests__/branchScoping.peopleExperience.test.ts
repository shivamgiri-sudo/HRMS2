import { beforeEach, describe, expect, it, vi } from "vitest";

/** People experience (owner ruling 2026-10-01): hr is branch-scoped, not "global". */
const { dbExecute, state } = vi.hoisted(() => ({ dbExecute: vi.fn(), state: { roles: ["hr"] as string[] } }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));
vi.mock("../../../shared/accessGuard.js", () => ({ getEmployeeForUser: async () => ({ id: "e1", employee_code: "C1" }) }));
const scope = await import("../people-experience.scope.js");

const req = { authUser: { id: "u1" } } as any;
beforeEach(() => {
  dbExecute.mockReset();
  dbExecute.mockImplementation(async (sql: string) => {
    if (/FROM user_roles/.test(sql)) return [state.roles.map((role_key) => ({ role_key })), []];
    if (/SELECT branch_id FROM employees/.test(sql)) return [[{ branch_id: "b1" }], []];
    return [[], []];
  });
});

describe("people-experience scope", () => {
  it("hr resolves to a branch scope limited to its own branch, and still manages grievances", async () => {
    const s = await scope.resolvePeopleExperienceScope(req);
    expect(s.kind).toBe("branch");
    expect(s.canManageGrievances).toBe(true);
    const cond = scope.buildEmployeeScopeCondition(s, "e");
    expect(cond.sql).toMatch(/e\.branch_id = \?/);
    expect(cond.params).toContain("b1");
  });
  it("admin is branch-scoped like hr, and still manages grievances (owner ruling 2026-10-01)", async () => {
    state.roles = ["admin"];
    const s = await scope.resolvePeopleExperienceScope(req);
    expect(s.kind).toBe("branch");
    expect(s.canManageGrievances).toBe(true);
    expect(scope.buildEmployeeScopeCondition(s, "e").sql).toMatch(/e\.branch_id = \?/);
  });
  it("ceo and super_admin stay global (1 = 1)", async () => {
    for (const r of ["ceo", "super_admin"]) {
      state.roles = [r];
      const s = await scope.resolvePeopleExperienceScope(req);
      expect(s.kind).toBe("global");
      expect(scope.buildEmployeeScopeCondition(s).sql).toBe("1 = 1");
    }
  });
  it("hr cannot open a grievance raised outside its branch", async () => {
    state.roles = ["hr"];
    dbExecute.mockImplementation(async (sql: string) => {
      if (/FROM user_roles/.test(sql)) return [[{ role_key: "hr" }], []];
      if (/SELECT branch_id FROM employees/.test(sql)) return [[{ branch_id: "b1" }], []];
      return [[], []]; // grievance not found inside scope
    });
    expect(await scope.canViewGrievance(req, "g-other")).toBe(false);
  });
});
