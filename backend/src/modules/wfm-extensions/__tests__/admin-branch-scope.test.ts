import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * accessGuard.hasRole() answers TRUE for admin / super_admin for ANY role, so `hasRole(u, ...ORG_WIDE_EXEMPT_ROLES)` made
 * admin org-wide in this router (owner ruling 2026-10-01: admin is branch-scoped like hr). The org-wide test is now
 * scopeAccess.hasAnyRole (super_admin-only shortcut), so admin gets the same own-branch predicate as hr.
 */
const h = vi.hoisted(() => ({
  hasAnyRole: vi.fn(), resolveScope: vi.fn(), summarize: vi.fn(async () => ({ ok: true })), recordExit: vi.fn(async () => "x1"),
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn(async () => [[], []]) } }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u1" }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({ requireRole: () => (_q: any, _s: any, next: any) => next() }));
// hasRole is TRUE for everything, exactly like the real one for an admin.
vi.mock("../../../shared/accessGuard.js", () => ({
  hasRole: vi.fn(async () => true), hasProcessScope: vi.fn(async () => false), getEmployeeForUser: vi.fn(async () => ({ id: "emp-me" })),
}));
vi.mock("../../../shared/scopeAccess.js", () => ({
  ORG_WIDE_EXEMPT_ROLES: ["super_admin", "ceo", "coo", "cfo", "payroll_head", "finance_head", "accounts_head", "finance"],
  hasAnyRole: h.hasAnyRole,
  buildScopeWhereClause: vi.fn(async () => ({ sql: "1=0", params: [] })),
}));
vi.mock("../../../shared/enterpriseScope.js", () => ({
  resolveUserBusinessScope: h.resolveScope,
  buildEmployeeScopeCondition: () => ({ sql: "e.branch_id = ?", params: ["branch-a"] }),
  canViewEmployee: vi.fn(async () => false),
}));
vi.mock("../../../shared/lobFilter.js", () => ({ readLobFilter: () => ({ lobId: null }) }));
vi.mock("../wfm-ext.service.js", () => ({
  rosterSwapService: { list: vi.fn(), create: vi.fn(), respond: vi.fn(), review: vi.fn() },
  rosterConflictService: { list: vi.fn(), resolve: vi.fn() },
  coverageService: { summarize: h.summarize, upsertSnapshot: vi.fn() },
  attritionService: { getSummary: vi.fn(), recordExit: h.recordExit },
}));

import { wfmExtRouter } from "../wfm-ext.routes.js";
const app = () => { const a = express(); a.use(express.json()); a.use("/api/wfm-ext", wfmExtRouter); return a; };
const scope = (roles: string[]) => ({
  userId: "u1", roles, employeeId: "emp-me", employeeCode: "C", branchId: "branch-a", processId: null, lobId: null, departmentId: null,
  isSuperAdmin: roles.includes("super_admin"), isAdmin: roles.includes("admin"), isHr: false, isPayroll: false, isFinance: false,
  assignments: roles.includes("admin") ? [{ roleKey: "admin", scopeType: "branch", branchId: "branch-a", processId: null, lobId: null, departmentId: null, managerEmployeeId: null, clientId: null }] : [],
});
const asRoles = (...r: string[]) => h.hasAnyRole.mockImplementation(async (_u: string, ...want: string[]) => r.includes("super_admin") || want.some((w) => r.includes(w)));

beforeEach(() => { vi.clearAllMocks(); });

describe("wfm-ext: admin is not org-wide", () => {
  it("coverage summary for admin carries the own-branch predicate, not 1=1", async () => {
    asRoles("admin"); h.resolveScope.mockResolvedValue(scope(["admin"]));
    await request(app()).get("/api/wfm-ext/coverage");
    const arg = (h.summarize.mock.calls[0] as any[])[0];
    expect(arg.sql).not.toBe("1=1");
    expect(arg.sql).toContain("e.branch_id = ?");
    expect(arg.params).toContain("branch-a");
  });
  it("coverage summary for an org-wide role stays 1=1", async () => {
    asRoles("ceo"); h.resolveScope.mockResolvedValue(scope(["ceo"]));
    await request(app()).get("/api/wfm-ext/coverage");
    expect((h.summarize.mock.calls[0] as any[])[0]).toMatchObject({ sql: "1=1", params: [] });
  });
  it("attrition record: admin is refused for an employee outside its branch", async () => {
    asRoles("admin"); h.resolveScope.mockResolvedValue(scope(["admin"]));
    const res = await request(app()).post("/api/wfm-ext/attrition/record").send({ employee_id: "emp-b", exit_date: "2026-09-01" });
    expect(res.status).toBe(403);
    expect(h.recordExit).not.toHaveBeenCalled();
  });
  it("attrition record: an org-wide role is not scope-checked", async () => {
    asRoles("ceo"); h.resolveScope.mockResolvedValue(scope(["ceo"]));
    const res = await request(app()).post("/api/wfm-ext/attrition/record").send({ employee_id: "emp-b", exit_date: "2026-09-01" });
    expect(res.status).toBe(201);
  });
});
