import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * attendance-engine routes: admin was treated as platform-wide by listScopedEmployees (and, with hr / wfm / manager,
 * could read or correct any employee's record by id). Owner ruling 2026-10-01: admin is branch-scoped like hr.
 */
const h = vi.hoisted(() => ({
  execute: vi.fn(), hasRole: vi.fn(), hasAnyRole: vi.fn(), resolveScope: vi.fn(), canViewEmployee: vi.fn(),
  getRecord: vi.fn(async () => ({ id: "rec" })), buildScopeWhereClause: vi.fn(async () => ({ sql: "e.branch_id = ?", params: ["branch-a"] })),
  listRecords: vi.fn(async () => ({ data: [], total: 0, page: 1, limit: 50 })),
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: h.execute } }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u1" }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({ requireRole: () => (_q: any, _s: any, next: any) => next() }));
vi.mock("../../../shared/accessGuard.js", () => ({ hasRole: h.hasRole, getEmployeeForUser: vi.fn(async () => ({ id: "emp-me" })) }));
vi.mock("../../../shared/scopeAccess.js", () => ({
  ORG_WIDE_EXEMPT_ROLES: ["super_admin", "ceo", "coo", "cfo", "payroll_head", "finance_head", "accounts_head", "finance"],
  hasAnyRole: h.hasAnyRole, buildScopeWhereClause: h.buildScopeWhereClause,
}));
vi.mock("../../../shared/enterpriseScope.js", () => ({
  resolveUserBusinessScope: h.resolveScope,
  buildEmployeeScopeCondition: () => ({ sql: "e.branch_id = ?", params: ["branch-a"] }),
  canViewEmployee: h.canViewEmployee,
}));
vi.mock("../attendance-engine.service.js", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  attendanceEngineService: { getRecord: h.getRecord, listRecords: h.listRecords },
}));

import { attendanceEngineRouter } from "../attendance-engine.routes.js";
const app = () => { const a = express(); a.use(express.json()); a.use("/api/wfm/attendance", attendanceEngineRouter); return a; };
const scope = (roles: string[]) => ({
  userId: "u1", roles, employeeId: "emp-me", employeeCode: "C", branchId: "branch-a", processId: null, lobId: null, departmentId: null,
  isSuperAdmin: roles.includes("super_admin"), isAdmin: roles.includes("admin"), isHr: false, isPayroll: false, isFinance: false,
  assignments: roles.includes("admin") ? [{ roleKey: "admin", scopeType: "branch", branchId: "branch-a", processId: null, lobId: null, departmentId: null, managerEmployeeId: null, clientId: null }] : [],
});
// hasRole is true for admin for ANY role (accessGuard); hasAnyRole only short-circuits for super_admin.
const as = (...r: string[]) => {
  h.hasRole.mockImplementation(async (_u: string, ...want: string[]) => r.includes("admin") || r.includes("super_admin") || want.some((w) => r.includes(w)));
  h.hasAnyRole.mockImplementation(async (_u: string, ...want: string[]) => r.includes("super_admin") || want.some((w) => r.includes(w)));
  h.resolveScope.mockResolvedValue(scope(r));
};

beforeEach(() => {
  vi.clearAllMocks();
  h.canViewEmployee.mockResolvedValue(false);
  h.execute.mockImplementation(async (sql: string) => {
    if (/SELECT branch_id, reporting_manager_id FROM employees/.test(sql)) return [[{ branch_id: "branch-b", reporting_manager_id: null }], []];
    return [[], []];
  });
});

describe("GET /daily/:employeeId/:date", () => {
  it("admin is refused for an employee of another branch", async () => {
    as("admin");
    expect((await request(app()).get("/api/wfm/attendance/daily/emp-b/2026-09-01")).status).toBe(403);
    expect(h.getRecord).not.toHaveBeenCalled();
  });
  it("admin may read an employee inside its scope", async () => {
    as("admin"); h.canViewEmployee.mockResolvedValue(true);
    expect((await request(app()).get("/api/wfm/attendance/daily/emp-a/2026-09-01")).status).toBe(200);
  });
  it("super_admin reads any employee", async () => {
    as("super_admin");
    expect((await request(app()).get("/api/wfm/attendance/daily/emp-b/2026-09-01")).status).toBe(200);
  });
});

describe("GET /daily list", () => {
  it("admin asking for another branch is refused; with no filter it is pinned to its own branch", async () => {
    as("admin");
    expect((await request(app()).get("/api/wfm/attendance/daily?branchId=branch-z")).status).toBe(403);
    expect(h.listRecords).not.toHaveBeenCalled();
    expect((await request(app()).get("/api/wfm/attendance/daily")).status).toBe(200);
    expect((h.listRecords.mock.calls[0] as any[])[0].branchId).toBe("branch-a");
  });
  it("admin naming another branch's employee is refused", async () => {
    as("admin");
    expect((await request(app()).get("/api/wfm/attendance/daily?employeeId=emp-b")).status).toBe(403);
  });
  it("super_admin is not narrowed", async () => {
    as("super_admin");
    await request(app()).get("/api/wfm/attendance/daily");
    expect((h.listRecords.mock.calls[0] as any[])[0].branchId).toBeUndefined();
  });
});

describe("PATCH /daily/:employeeId/:date", () => {
  it("admin may not correct another branch's record", async () => {
    as("admin");
    const res = await request(app()).patch("/api/wfm/attendance/daily/emp-b/2026-09-01")
      .send({ attendanceStatus: "present", lwpValue: 0, overrideReason: "fixing a punch" });
    expect(res.status).toBe(403);
  });
});

describe("ncosec-monthly (listScopedEmployees)", () => {
  it("admin goes through buildScopeWhereClause instead of the platform-wide read", async () => {
    as("admin");
    h.execute.mockImplementation(async (sql: string) => (/role_key/.test(sql) ? [[{ role_key: "admin" }], []] : [[], []]));
    await request(app()).get("/api/wfm/attendance/ncosec-monthly?fromDate=2026-09-01&toDate=2026-09-30");
    expect(h.buildScopeWhereClause).toHaveBeenCalled();
  });
  it("super_admin reads platform-wide (no scope clause)", async () => {
    as("super_admin");
    h.execute.mockImplementation(async (sql: string) => (/role_key/.test(sql) ? [[{ role_key: "super_admin" }], []] : [[], []]));
    await request(app()).get("/api/wfm/attendance/ncosec-monthly?fromDate=2026-09-01&toDate=2026-09-30");
    expect(h.buildScopeWhereClause).not.toHaveBeenCalled();
  });
});
