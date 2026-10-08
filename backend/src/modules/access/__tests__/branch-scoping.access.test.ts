import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** /api/access users / branches / processes / roles-of-user: hr and admin are limited to their own branch; only the ORG_WIDE_EXEMPT_ROLES (super_admin, ceo, ...) are org-wide. */
const { execute, canViewEmployee, resolveScope, buildCond } = vi.hoisted(() => ({
  execute: vi.fn(), canViewEmployee: vi.fn(),
  resolveScope: vi.fn(), buildCond: vi.fn(),
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/enterpriseScope.js", () => ({
  canViewEmployee, resolveUserBusinessScope: resolveScope, buildEmployeeScopeCondition: buildCond,
}));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u-caller", roles: ["hr"] }; req.userRoles = ["hr"]; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({ requireRole: () => (_q: any, _s: any, next: any) => next() }));
vi.mock("../access.service.js", () => ({ getUserRoles: vi.fn(async () => ["employee"]) }));
vi.mock("../role-page-access.service.js", () => ({}));
vi.mock("../user-page-access.service.js", () => ({}));

const { accessRouter } = await import("../access.routes.js");
const app = () => { const a = express(); a.use(express.json()); a.use("/api/access", accessRouter); return a; };

const hrScope = { roles: ["hr"], branchId: "b1", assignments: [{ scopeType: "branch", branchId: "b3" }, { scopeType: "all", branchId: null }] };
const adminScope = { roles: ["super_admin"], branchId: "b1", assignments: [] }; // org-wide caller
const branchAdminScope = { ...hrScope, roles: ["admin"] }; // admin is branch-scoped since 2026-10-01
const sqlCalls = (re: RegExp) => execute.mock.calls.filter((c) => re.test(String(c[0])));

beforeEach(() => {
  execute.mockReset(); canViewEmployee.mockReset(); resolveScope.mockReset(); buildCond.mockReset();
  execute.mockImplementation(async (sql: string) => /COUNT\(\*\) AS total/.test(String(sql)) ? [[{ total: 0 }], []] : [[], []]);
  resolveScope.mockResolvedValue(hrScope);
  buildCond.mockReturnValue({ sql: "e.branch_id = ?", params: ["b1"] });
});

describe("GET /users", () => {
  it("hr: both union arms carry the scope predicate and hide employee-less accounts", async () => {
    await request(app()).get("/api/access/users?search=ab");
    const rowsSql = String(sqlCalls(/AS combined/).find((c) => !/COUNT/.test(String(c[0])))![0]);
    expect(rowsSql).toMatch(/e\.id IS NOT NULL AND \(e\.branch_id = \?\)/);
    expect(rowsSql).toMatch(/e\.user_id IS NULL AND e\.active_status = 1 .*AND \(e\.branch_id = \?\)/s);
  });
  it("org-wide (super_admin): no scope predicate", async () => {
    resolveScope.mockResolvedValue(adminScope);
    await request(app()).get("/api/access/users?search=ab");
    const rowsSql = String(sqlCalls(/AS combined/).find((c) => !/COUNT/.test(String(c[0])))![0]);
    expect(rowsSql).not.toMatch(/e\.branch_id = \?/);
    expect(buildCond).not.toHaveBeenCalled();
  });
});

describe("admin is branch-scoped like hr", () => {
  it("users carry the scope predicate, branches are limited, a foreign branchId is 403", async () => {
    resolveScope.mockResolvedValue(branchAdminScope);
    await request(app()).get("/api/access/users?search=ab");
    const rowsSql = String(sqlCalls(/AS combined/).find((c) => !/COUNT/.test(String(c[0])))![0]);
    expect(rowsSql).toMatch(/e\.id IS NOT NULL AND \(e\.branch_id = \?\)/);
    await request(app()).get("/api/access/branches");
    expect(String(sqlCalls(/FROM branch_master/)[0][0])).toMatch(/AND id IN \(\?,\?\)/);
    expect((await request(app()).get("/api/access/processes?branchId=b9")).status).toBe(403);
  });
});

describe("GET /branches and /processes", () => {
  it("hr sees only its own + assigned branches", async () => {
    await request(app()).get("/api/access/branches");
    const c = sqlCalls(/FROM branch_master/)[0];
    expect(String(c[0])).toMatch(/AND id IN \(\?,\?\)/);
    expect(c[1]).toEqual(["b1", "b3"]);
  });
  it("org-wide (super_admin) sees all branches", async () => {
    resolveScope.mockResolvedValue(adminScope);
    await request(app()).get("/api/access/branches");
    expect(String(sqlCalls(/FROM branch_master/)[0][0])).not.toMatch(/id IN/);
  });
  it("hr with no resolvable branch gets an empty list, not everything", async () => {
    resolveScope.mockResolvedValue({ roles: ["hr"], branchId: null, assignments: [] });
    const res = await request(app()).get("/api/access/branches");
    expect(res.body.data).toEqual([]);
    expect(sqlCalls(/FROM branch_master/).length).toBe(0);
  });
  it("processes: foreign ?branchId is 403, own is allowed, none -> pinned to own branches", async () => {
    expect((await request(app()).get("/api/access/processes?branchId=b9")).status).toBe(403);
    expect((await request(app()).get("/api/access/processes?branchId=b1")).status).toBe(200);
    execute.mockClear();
    await request(app()).get("/api/access/processes");
    const c = sqlCalls(/FROM process_master pm/)[0];
    expect(String(c[0])).toMatch(/e\.branch_id IN \(\?,\?\)/);
    expect(c[1]).toEqual(["b1", "b3"]);
  });
  it("org-wide (super_admin) may pass any branchId to processes", async () => {
    resolveScope.mockResolvedValue(adminScope);
    expect((await request(app()).get("/api/access/processes?branchId=b9")).status).toBe(200);
  });
});

describe("GET /roles/user/:userId", () => {
  it("hr is refused for a user outside its branch, allowed inside, self always allowed", async () => {
    execute.mockImplementation(async (sql: string) => /FROM employees WHERE user_id/.test(String(sql)) ? [[{ id: "emp-x" }], []] : [[], []]);
    canViewEmployee.mockResolvedValue(false);
    expect((await request(app()).get("/api/access/roles/user/u-other")).status).toBe(403);
    canViewEmployee.mockResolvedValue(true);
    expect((await request(app()).get("/api/access/roles/user/u-other")).status).toBe(200);
    canViewEmployee.mockResolvedValue(false);
    expect((await request(app()).get("/api/access/roles/user/u-caller")).status).toBe(200);
  });
  it("org-wide (super_admin) is unrestricted", async () => {
    resolveScope.mockResolvedValue(adminScope);
    expect((await request(app()).get("/api/access/roles/user/u-other")).status).toBe(200);
    expect(canViewEmployee).not.toHaveBeenCalled();
  });
});
