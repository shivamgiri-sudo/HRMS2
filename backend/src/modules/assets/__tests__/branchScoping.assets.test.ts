import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Assets (owner ruling 2026-10-01): hr only sees / changes assets of its own branch. */
const { dbExecute, canViewEmployee, scopeState } = vi.hoisted(() => ({
  dbExecute: vi.fn(), canViewEmployee: vi.fn(),
  scopeState: { roles: ["hr"] as string[], branchId: "b1" as string | null, assignments: [] as any[] },
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute } }));
vi.mock("../../../shared/enterpriseScope.js", () => ({
  canViewEmployee,
  resolveUserBusinessScope: async () => ({ ...scopeState, employeeId: "e-self" }),
  buildEmployeeScopeCondition: (s: any) => (s.roles.includes("admin") ? { sql: "1=1", params: [] } : { sql: "se.branch_id = ?", params: ["b1"] }),
}));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u-hr" }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({ requireRole: () => (_q: any, _s: any, next: any) => next() }));
vi.mock("../../../shared/accessGuard.js", () => ({ getEmployeeForUser: vi.fn(async () => ({ id: "e-self" })), hasRole: vi.fn(async () => true) }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn() }));
vi.mock("../assets.service.js", () => ({
  assetsService: {
    list: vi.fn(async () => []), create: vi.fn(async (b: any) => b), update: vi.fn(async () => ({})), getById: vi.fn(async () => ({ id: "a1" })),
    getHistory: vi.fn(async () => []), assign: vi.fn(async () => ({})), listByEmployee: vi.fn(async () => []),
  },
}));

const { assetsRouter } = await import("../assets.routes.js");
const { assetsService } = await import("../assets.service.js");
const app = () => { const a = express(); a.use(express.json()); a.use("/api/assets-mgmt", assetsRouter); return a; };

beforeEach(() => {
  scopeState.roles = ["hr"]; scopeState.branchId = "b1"; scopeState.assignments = [];
  canViewEmployee.mockReset(); dbExecute.mockReset();
  (assetsService.list as any).mockClear(); (assetsService.create as any).mockClear();
  // asset exists; in-scope lookup returns a row only for the in-branch asset
  dbExecute.mockImplementation(async (sql: string, params: any[]) => {
    if (/SELECT id FROM asset_master/.test(sql)) return [[{ id: params[0] }], []];
    if (/SELECT 1 AS ok FROM asset_master/.test(sql)) return [params[0] === "a-mine" ? [{ ok: 1 }] : [], []];
    return [[], []];
  });
});

describe("assets branch scoping", () => {
  it("list passes the caller's branch predicate to the service", async () => {
    await request(app()).get("/api/assets-mgmt");
    const scope = (assetsService.list as any).mock.calls[0][1];
    expect(scope.sql).toMatch(/a\.branch_id IN \(\?\)/);
    expect(scope.params).toContain("b1");
  });
  it("org-wide roles get no predicate", async () => {
    scopeState.roles = ["super_admin"];
    await request(app()).get("/api/assets-mgmt");
    expect((assetsService.list as any).mock.calls[0][1].sql).toBe("1=1");
  });
  it("admin is branch-scoped like hr (owner ruling 2026-10-01)", async () => {
    scopeState.roles = ["admin"];
    await request(app()).get("/api/assets-mgmt");
    const scope = (assetsService.list as any).mock.calls[0][1];
    expect(scope.sql).toMatch(/a\.branch_id IN \(\?\)/);
    expect(scope.params).toContain("b1");
  });
  it("asset in another branch: detail, history, update, assign, return, service, delete are 403", async () => {
    const a = app();
    expect((await request(a).get("/api/assets-mgmt/a-other")).status).toBe(403);
    expect((await request(a).get("/api/assets-mgmt/a-other/history")).status).toBe(403);
    expect((await request(a).put("/api/assets-mgmt/a-other").send({})).status).toBe(403);
    expect((await request(a).post("/api/assets-mgmt/a-other/assign").send({ employee_id: "x" })).status).toBe(403);
    expect((await request(a).post("/api/assets-mgmt/a-other/return").send({})).status).toBe(403);
    expect((await request(a).post("/api/assets-mgmt/a-other/service").send({})).status).toBe(403);
    expect((await request(a).delete("/api/assets-mgmt/a-other")).status).toBe(403);
  });
  it("asset in own branch is readable", async () => {
    expect((await request(app()).get("/api/assets-mgmt/a-mine")).status).toBe(200);
  });
  it("cannot assign an in-branch asset to an employee outside the branch", async () => {
    canViewEmployee.mockResolvedValue(false);
    expect((await request(app()).post("/api/assets-mgmt/a-mine/assign").send({ employee_id: "emp-b" })).status).toBe(403);
  });
  it("cannot create or move an asset into a foreign branch; own branch is the default", async () => {
    expect((await request(app()).post("/api/assets-mgmt").send({ asset_name: "x", branch_id: "b-other" })).status).toBe(403);
    expect((await request(app()).put("/api/assets-mgmt/a-mine").send({ branch_id: "b-other" })).status).toBe(403);
    await request(app()).post("/api/assets-mgmt").send({ asset_name: "x" });
    expect((assetsService.create as any).mock.calls[0][0].branch_id).toBe("b1");
  });
  it("/employee/:id for hr is limited to employees it can see", async () => {
    canViewEmployee.mockResolvedValue(false);
    expect((await request(app()).get("/api/assets-mgmt/employee/emp-b")).status).toBe(403);
    canViewEmployee.mockResolvedValue(true);
    expect((await request(app()).get("/api/assets-mgmt/employee/emp-a")).status).toBe(200);
  });
});
