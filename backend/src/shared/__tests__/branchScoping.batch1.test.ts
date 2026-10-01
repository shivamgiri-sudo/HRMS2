import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Branch scoping, batch 1 (personal / statutory data) - owner ruling 2026-10-01: hr is limited to its
 * own branch. These pin the three entry points that used to treat "admin/hr" as "any employee":
 *   - selfOrAdminHr (shared guard behind lifecycle, employee documents, engagement)
 *   - GET /analytics/employee-360/:id
 *   - GET/PATCH statutory change requests
 */
const { canViewEmployee, dbExecute, resolveScope, buildCond } = vi.hoisted(() => ({
  canViewEmployee: vi.fn(),
  dbExecute: vi.fn(),
  resolveScope: vi.fn(async () => ({ __scope: true })),
  buildCond: vi.fn(() => ({ sql: "e.branch_id = ?", params: ["branch-a"] })),
}));

vi.mock("../enterpriseScope.js", () => ({
  canViewEmployee, resolveUserBusinessScope: resolveScope, buildEmployeeScopeCondition: buildCond,
}));
vi.mock("../../db/mysql.js", () => ({
  db: { execute: dbExecute, getConnection: vi.fn(async () => ({
    beginTransaction: vi.fn(), rollback: vi.fn(), commit: vi.fn(), release: vi.fn(),
    execute: vi.fn(async (sql: string) => {
      if (/FROM profile_update_approval/.test(sql)) return [[{ id: "r1", employee_id: "emp-b", status: "pending", new_values: "{}", old_values: "{}" }], []];
      return [[], []];
    }),
  })) },
}));
vi.mock("../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u-hr" }; next(); },
}));
vi.mock("../../middleware/requireRole.js", () => ({ requireRole: () => (_q: any, _s: any, next: any) => next() }));
vi.mock("../requestContext.js", () => ({ memoizeForRequest: (_k: string, fn: () => unknown) => fn() }));
vi.mock("../demoAuth.js", () => ({ demoRoleForUserId: () => null }));
vi.mock("../auditLog.js", () => ({ logSensitiveAction: vi.fn() }));
vi.mock("../syncPiiEncryption.js", () => ({
  encryptPanForSync: vi.fn(), blindIndexPan: vi.fn(), encryptAadhaarForSync: vi.fn(), blindIndexAadhaar: vi.fn(),
}));
vi.mock("../../modules/analytics/employee-360.service.js", () => ({
  getEmployee360Profile: (_req: any, res: any) => res.json({ ok: true }),
}));

const scenario: { roles: string[]; emp: { id: string; employee_code: string } | null } = { roles: [], emp: null };
beforeEach(() => {
  canViewEmployee.mockReset(); dbExecute.mockReset();
  scenario.roles = []; scenario.emp = null;
  // accessGuard resolves roles and the caller's employee through db.execute.
  dbExecute.mockImplementation(async (sql: string) => {
    if (/role_key/.test(sql)) return [scenario.roles.map((role_key) => ({ role_key })), []];
    if (/FROM employees e\s+WHERE e\.user_id/.test(sql)) return [scenario.emp ? [scenario.emp] : [], []];
    return [[], []];
  });
});

describe("selfOrAdminHr", () => {
  const run = async (target: string) => {
    const { selfOrAdminHr } = await import("../accessGuard.js");
    const a = express();
    a.get("/employees/:id/x", (req: any, _res, next) => { req.authUser = { id: "u-hr" }; next(); }, selfOrAdminHr("id"), (_q, res) => res.json({ ok: true }));
    return request(a).get(`/employees/${target}/x`);
  };

  it("hr inside its branch passes", async () => {
    scenario.roles = ["hr"]; canViewEmployee.mockResolvedValue(true);
    expect((await run("emp-a")).status).toBe(200);
  });
  it("hr outside its branch is refused (was: any employee)", async () => {
    scenario.roles = ["hr"]; canViewEmployee.mockResolvedValue(false);
    const res = await run("emp-b");
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/outside your branch/);
  });
  it("an employee can still open their own record", async () => {
    scenario.roles = ["employee"]; scenario.emp = { id: "emp-self", employee_code: "E1" };
    expect((await run("emp-self")).status).toBe(200);
    expect((await run("emp-other")).status).toBe(403);
  });
});

describe("employee 360", () => {
  const get = async () => {
    const { employee360Router } = await import("../../modules/analytics/employee-360.routes.js");
    const a = express(); a.use("/api/analytics/employee-360", employee360Router);
    return request(a).get("/api/analytics/employee-360/emp-x");
  };
  it("is refused outside the caller's branch", async () => {
    canViewEmployee.mockResolvedValue(false);
    expect((await get()).status).toBe(403);
  });
  it("opens inside it", async () => {
    canViewEmployee.mockResolvedValue(true);
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe("statutory change requests", () => {
  const app = async () => {
    const mod: any = await import("../../modules/employees/statutory-approval.routes.js");
    const a = express(); a.use(express.json()); a.use("/api/statutory-change-requests", mod.default ?? mod.statutoryApprovalRouter ?? mod.router);
    return a;
  };
  it("the pending list is filtered by the caller's scope condition", async () => {
    await request(await app()).get("/api/statutory-change-requests/pending");
    const call = dbExecute.mock.calls.find(([sql]) => /profile_update_approval/.test(String(sql)));
    expect(String(call?.[0])).toMatch(/AND \(e\.branch_id = \?\)/);
    expect(call?.[1]).toEqual(["branch-a"]);
  });
  it("deciding a request for an employee outside the branch is refused", async () => {
    canViewEmployee.mockResolvedValue(false);
    const res = await request(await app()).patch("/api/statutory-change-requests/r1").send({ decision: "approved" });
    expect(res.status).toBe(403);
    expect(canViewEmployee).toHaveBeenCalledWith({ id: "u-hr" }, "emp-b");
  });
});
