import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Owner policy 2026-10-01: admin is BRANCH-SCOPED like hr.
 *  - employee.secure canAccessEmployee (stat-card gate) used to wave admin through for every employee.
 *  - GET /payroll/epf-compliance used to give admin "1=1" instead of own-branch.
 */
const m = vi.hoisted(() => ({
  execute: vi.fn(),
  hasAnyRole: vi.fn(),
  getUserRoleKeys: vi.fn(),
  hasScopedAccess: vi.fn(),
  buildScopeWhereClause: vi.fn(),
  getEmployeeForUser: vi.fn(),
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute: m.execute, query: m.execute, getConnection: vi.fn() } }));
vi.mock("../../../db/billDb.js", () => ({ getBillPool: vi.fn() }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u1" }; next(); },
  requireWriteAccess: (_q: any, _s: any, next: any) => next(),
}));
vi.mock("../../../middleware/requireRole.js", () => ({ requireRole: () => (_q: any, _s: any, next: any) => next() }));
vi.mock("../../../shared/scopeAccess.js", () => ({
  hasAnyRole: m.hasAnyRole, getUserRoleKeys: m.getUserRoleKeys, hasScopedAccess: m.hasScopedAccess,
  buildScopeWhereClause: m.buildScopeWhereClause,
  ORG_WIDE_EXEMPT_ROLES: ["super_admin", "ceo", "coo", "cfo", "finance", "payroll_head", "finance_head", "accounts_head", "department_head", "hr_head"],
}));
vi.mock("../../../shared/accessGuard.js", async (orig) => ({ ...(await orig<object>()), getEmployeeForUser: m.getEmployeeForUser }));

const roles = (...held: string[]) => {
  m.getUserRoleKeys.mockResolvedValue(held);
  m.hasAnyRole.mockImplementation(async (_u: string, ...want: string[]) => held.includes("super_admin") || want.some((r) => held.includes(r)));
};
const ID = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.getEmployeeForUser.mockResolvedValue({ id: "emp-self" });
  m.execute.mockResolvedValue([[{ id: ID, branch_id: "b2", process_id: "p", reporting_manager_id: null }], []]);
});

describe("employee.secure stat-card scope gate", () => {
  const get = async () => {
    const { employeeSecureRouter } = await import("../employee.secure.routes.js");
    const a = express(); a.use(express.json()); a.use("/employees", employeeSecureRouter);
    return request(a).get(`/employees/${ID}/stat-card`);
  };

  it("admin outside their branch is refused (was: any employee)", async () => {
    roles("admin"); m.hasScopedAccess.mockResolvedValue(false);
    expect((await get()).status).toBe(403);
    expect(m.hasScopedAccess).toHaveBeenCalled();
  });
  it("admin inside their branch gets past the gate", async () => {
    roles("admin"); m.hasScopedAccess.mockResolvedValue(true);
    expect((await get()).status).not.toBe(403);
  });
  it("ceo and admin+coo still skip the scope check", async () => {
    roles("ceo");
    expect((await get()).status).not.toBe(403);
    roles("admin", "coo");
    expect((await get()).status).not.toBe(403);
    expect(m.hasScopedAccess).not.toHaveBeenCalled();
  });
});

describe("GET /payroll/epf-compliance", () => {
  const get = async () => {
    const { payrollEpfComplianceRouter } = await import("../employee.compliance.routes.js");
    const a = express(); a.use(express.json()); a.use("/payroll", payrollEpfComplianceRouter);
    return request(a).get("/payroll/epf-compliance");
  };
  const lastQuery = () => m.execute.mock.calls.at(-1) as [string, unknown[]];

  it("admin gets the scoped (own-branch) clause, not 1=1", async () => {
    roles("admin");
    m.buildScopeWhereClause.mockResolvedValue({ sql: "p.branch_id = ?", params: ["b1"] });
    m.execute.mockResolvedValue([[], []]);
    await get();
    const [sql, params] = lastQuery();
    expect(sql).toContain("WHERE (p.branch_id = ?)");
    expect(params).toEqual(["b1"]);
    expect(m.buildScopeWhereClause).toHaveBeenCalledWith("u1", expect.any(Array), expect.any(Object), expect.objectContaining({ allowAdminBypass: true }));
  });
  it("super_admin still gets the unfiltered query", async () => {
    roles("super_admin");
    m.buildScopeWhereClause.mockResolvedValue({ sql: "1=1", params: [] });
    m.execute.mockResolvedValue([[], []]);
    await get();
    const [sql, params] = lastQuery();
    expect(sql).toContain("WHERE (1=1)");
    expect(params).toEqual([]);
  });
});
