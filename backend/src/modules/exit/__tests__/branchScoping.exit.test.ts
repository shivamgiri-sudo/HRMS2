import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Branch scoping for exit (owner ruling 2026-10-01): hr is limited to its own branch; org-wide roles
 * are unaffected; the clearance queue no longer fails open.
 */
const { dbExecute, canViewEmployee, resolveScope, buildCond, dashScope } = vi.hoisted(() => ({
  dbExecute: vi.fn(),
  canViewEmployee: vi.fn(),
  resolveScope: vi.fn(async () => ({ __scope: true })),
  buildCond: vi.fn((): { sql: string; params: unknown[] } => ({ sql: "e.branch_id = ?", params: ["branch-a"] })),
  dashScope: vi.fn(),
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute: dbExecute, query: dbExecute } }));
vi.mock("../../../shared/enterpriseScope.js", () => ({
  canViewEmployee, resolveUserBusinessScope: resolveScope, buildEmployeeScopeCondition: buildCond,
}));
vi.mock("../../../shared/dashboardScope.js", () => ({ resolveDashboardScope: dashScope }));
vi.mock("../../../shared/roleResolver.js", () => ({ getUserRoleContext: async () => ({ primaryRole: "manager", roleKeys: ["manager"] }) }));
vi.mock("../../../shared/reportingSpan.js", () => ({ isInReportingSpan: vi.fn(async () => false) }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u1", roles: ["hr"] }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({ requireRole: () => (_q: any, _s: any, next: any) => next() }));
vi.mock("../../../shared/accessGuard.js", () => ({ getEmployeeForUser: vi.fn(async () => null), hasRole: vi.fn(async () => true) }));
vi.mock("../exit.controller.js", () => ({ exitController: { getExitStats: vi.fn(), listExitRequests: vi.fn(), createExitRequest: vi.fn(), getExitRequest: vi.fn() } }));
vi.mock("../exit.service.js", () => ({ exitService: {}, transitionExitStatus: vi.fn() }));
vi.mock("../ff.service.js", () => ({ ffService: { getFF: vi.fn(async () => ({ id: "ff" })) } }));
vi.mock("../ff-compute.service.js", () => ({ computeFfPreview: vi.fn() }));
vi.mock("../exit-analytics.service.js", () => ({ getExitAnalyticsSummary: vi.fn(async () => ({})) }));
vi.mock("../exit-intelligence.service.js", () => ({}));
vi.mock("../resignation.routes.js", () => ({ resignationRouter: (_q: any, _s: any, next: any) => next() }));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn() }));

const { exitRouter } = await import("../exit.routes.js");

const app = () => { const a = express(); a.use(express.json()); a.use("/api/exit", exitRouter); return a; };

beforeEach(() => {
  dbExecute.mockReset(); canViewEmployee.mockReset(); dashScope.mockReset();
  buildCond.mockImplementation(() => ({ sql: "e.branch_id = ?", params: ["branch-a"] }));
  dbExecute.mockImplementation(async (sql: string) => {
    if (/role_key FROM user_roles/.test(sql)) return [[{ role_key: "hr" }], []];
    if (/full_final_calculation f JOIN exit_request er/.test(sql)) return [[{ employee_id: "emp-b" }], []];
    if (/SELECT employee_id FROM exit_request/.test(sql)) return [[{ employee_id: "emp-b" }], []];
    if (/COUNT\(\*\) AS total/.test(sql)) return [[{ total: 0 }], []];
    return [[], []];
  });
});

describe("exit branch scoping", () => {
  it("clearance queue for hr carries the caller's branch predicate", async () => {
    const res = await request(app()).get("/api/exit/clearance/queue");
    expect(res.status).toBe(200);
    const listCall = dbExecute.mock.calls.find(([sql]) => /FROM exit_clearance_task t/.test(sql) && /LIMIT/.test(sql))!;
    expect(listCall[0]).toMatch(/\(e\.branch_id = \?\)/);
    expect(listCall[1]).toContain("branch-a");
  });

  it("clearance queue for a manager with a team scope (no branchIds) is restricted to the team, not open", async () => {
    dbExecute.mockImplementation(async (sql: string) => {
      if (/role_key FROM user_roles/.test(sql)) return [[{ role_key: "manager" }], []];
      return [[{ total: 0 }], []];
    });
    const hasRole = (await import("../../../shared/accessGuard.js")).hasRole as any;
    hasRole.mockResolvedValueOnce(false);
    dashScope.mockResolvedValue({ level: "TEAM_ONLY", branchIds: [], processIds: [], employeeIds: ["emp-1"] });
    await request(app()).get("/api/exit/clearance/queue");
    const listCall = dbExecute.mock.calls.find(([sql]) => /FROM exit_clearance_task t/.test(sql) && /LIMIT/.test(sql))!;
    expect(listCall[0]).toMatch(/e\.id IN \(\?\)/);
    expect(listCall[1]).toContain("emp-1");
  });

  it("clearance queue fails closed when the scope cannot be resolved", async () => {
    const hasRole = (await import("../../../shared/accessGuard.js")).hasRole as any;
    hasRole.mockResolvedValueOnce(false);
    dashScope.mockRejectedValue(new Error("no scope"));
    await request(app()).get("/api/exit/clearance/queue");
    const listCall = dbExecute.mock.calls.find(([sql]) => /FROM exit_clearance_task t/.test(sql) && /LIMIT/.test(sql))!;
    expect(listCall[0]).toMatch(/\(1=0\)/);
  });

  it("F&F read for an employee outside hr's branch is 403", async () => {
    canViewEmployee.mockResolvedValue(false);
    const res = await request(app()).get("/api/exit/ff/exit-1");
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/outside your branch/);
  });

  it("F&F read inside the branch passes; org-wide callers are never refused", async () => {
    canViewEmployee.mockResolvedValue(true);
    expect((await request(app()).get("/api/exit/ff/exit-1")).status).toBe(200);
  });

  it("F&F paid is guarded through the F&F row's employee", async () => {
    canViewEmployee.mockResolvedValue(false);
    const res = await request(app()).post("/api/exit/ff/ff-1/paid").send({ paymentReference: "UTR1" });
    expect(res.status).toBe(403);
    expect(dbExecute.mock.calls.some(([sql]) => /full_final_calculation f JOIN exit_request er/.test(sql))).toBe(true);
  });

  it("approve / return / clearance generate are refused outside the branch", async () => {
    canViewEmployee.mockResolvedValue(false);
    expect((await request(app()).patch("/api/exit/ex-1/approve").send({})).status).toBe(403);
    expect((await request(app()).patch("/api/exit/ex-1/return").send({ reason: "x" })).status).toBe(403);
    expect((await request(app()).post("/api/exit/ex-1/clearance/generate").send({})).status).toBe(403);
  });
});
