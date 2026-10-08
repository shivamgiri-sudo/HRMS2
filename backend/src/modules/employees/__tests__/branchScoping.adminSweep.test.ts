import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Owner policy 2026-10-01: admin is BRANCH-SCOPED like hr. These pin the employees-module places where
 * "admin" used to short-circuit scope:
 *   - canViewEmployeeBgv (employee-bgv.service)
 *   - resolveEmployeeDocumentAccessContext (joining documents canManage)
 * super_admin / org-wide roles stay unrestricted.
 */
const { dbExecute, getUserRoleKeys, hasScopedAccess, hasAnyRole, getEmployeeForUser } = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  getUserRoleKeys: vi.fn(),
  hasScopedAccess: vi.fn(),
  hasAnyRole: vi.fn(async () => false),
  getEmployeeForUser: vi.fn(async () => ({ id: "emp-actor" })),
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute, query: dbExecute } }));
vi.mock("../../../shared/scopeAccess.js", () => ({
  getUserRoleKeys, hasScopedAccess, hasAnyRole,
  ORG_WIDE_EXEMPT_ROLES: ["super_admin", "ceo", "coo", "cfo", "payroll_head", "finance_head", "accounts_head", "finance", "department_head", "hr_head"],
}));
vi.mock("../../../shared/accessGuard.js", () => ({ getEmployeeForUser }));
vi.mock("../../ats/bgv-verification.service.js", () => ({ computeAndSaveScore: vi.fn() }));

const { canViewEmployeeBgv } = await import("../employee-bgv.service.js");
const { resolveEmployeeDocumentAccessContext } = await import("../employeeJoiningDocuments.service.js");

beforeEach(() => {
  dbExecute.mockReset(); getUserRoleKeys.mockReset(); hasScopedAccess.mockReset();
  getEmployeeForUser.mockResolvedValue({ id: "emp-actor" });
});

describe("canViewEmployeeBgv", () => {
  const branches = (actor: string | null, target: string | null) => {
    dbExecute.mockImplementation(async (sql: string) => {
      if (/WHERE e\.user_id/.test(sql)) return [actor === null ? [] : [{ branch_id: actor, process_id: "p" }], []];
      return [[{ branch_id: target, process_id: "p" }], []];
    });
  };

  it("super_admin sees any branch without a lookup", async () => {
    expect(await canViewEmployeeBgv("u", "e", ["super_admin"])).toBe(true);
    expect(dbExecute).not.toHaveBeenCalled();
  });
  it("admin in the same branch passes", async () => {
    branches("b1", "b1");
    expect(await canViewEmployeeBgv("u", "e", ["admin"])).toBe(true);
  });
  it("admin in another branch is refused (was: any employee)", async () => {
    branches("b1", "b2");
    expect(await canViewEmployeeBgv("u", "e", ["admin"])).toBe(false);
  });
  it("admin with no branch of their own is refused (fail closed)", async () => {
    branches(null, "b2");
    expect(await canViewEmployeeBgv("u", "e", ["admin"])).toBe(false);
  });
  it("admin that also holds an org-wide role stays unrestricted", async () => {
    expect(await canViewEmployeeBgv("u", "e", ["admin", "coo"])).toBe(true);
  });
});

describe("resolveEmployeeDocumentAccessContext", () => {
  const target = { id: "emp-t", branch_id: "b2", process_id: "p", lob_id: null, department_id: "d", reporting_manager_id: null, manager_id: null };
  beforeEach(() => { dbExecute.mockResolvedValue([[target], []]); });

  it("admin outside their branch goes through hasScopedAccess and is refused with 403", async () => {
    getUserRoleKeys.mockResolvedValue(["admin"]);
    hasScopedAccess.mockResolvedValue(false);
    await expect(resolveEmployeeDocumentAccessContext("u", "emp-t")).rejects.toMatchObject({ statusCode: 403 });
    expect(hasScopedAccess).toHaveBeenCalledTimes(1);
  });
  it("admin inside their branch passes", async () => {
    getUserRoleKeys.mockResolvedValue(["admin"]);
    hasScopedAccess.mockResolvedValue(true);
    const ctx = await resolveEmployeeDocumentAccessContext("u", "emp-t");
    expect(ctx.canManage).toBe(true);
    expect(ctx.isAdmin).toBe(true); // role gate flag unchanged
  });
  it("super_admin skips the scope check", async () => {
    getUserRoleKeys.mockResolvedValue(["super_admin"]);
    const ctx = await resolveEmployeeDocumentAccessContext("u", "emp-t");
    expect(ctx.canManage).toBe(true);
    expect(hasScopedAccess).not.toHaveBeenCalled();
  });
  it("admin + org-wide role skips the scope check", async () => {
    getUserRoleKeys.mockResolvedValue(["admin", "cfo"]);
    getEmployeeForUser.mockResolvedValue({ id: "emp-actor" });
    const ctx = await resolveEmployeeDocumentAccessContext("u", "emp-t");
    expect(ctx.canManage).toBe(true);
    expect(hasScopedAccess).not.toHaveBeenCalled();
  });
});
