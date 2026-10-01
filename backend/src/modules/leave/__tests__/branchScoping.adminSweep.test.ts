import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Owner policy 2026-10-01: admin is BRANCH-SCOPED like hr.
 *  - canReviewLeave: admin used to be approver for every leave request in every branch.
 *  - POST /leave/requests: a "privileged" caller (admin/hr/manager ...) used to file leave for ANY employee.
 */
const m = vi.hoisted(() => ({
  execute: vi.fn(),
  hasAnyRole: vi.fn(),
  hasRole: vi.fn(),
  getEmployeeForUser: vi.fn(),
  resolveScope: vi.fn(),
  submitRequest: vi.fn(),
}));

vi.mock("../../../db/mysql.js", () => ({ db: { execute: m.execute, query: m.execute } }));
vi.mock("../../../db/legacyDb.js", () => ({ getLegacyPool: vi.fn() }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u-admin" }; next(); },
  requireWriteAccess: (_q: any, _s: any, next: any) => next(),
}));
vi.mock("../../../middleware/requireRole.js", () => ({ requireRole: () => (_q: any, _s: any, next: any) => next() }));
vi.mock("../../../shared/accessGuard.js", () => ({ getEmployeeForUser: m.getEmployeeForUser, hasRole: m.hasRole }));
vi.mock("../../../shared/scopeAccess.js", () => ({
  hasAnyRole: m.hasAnyRole,
  buildScopeWhereClause: vi.fn(async () => ({ sql: "1=1", params: [] })),
  ORG_WIDE_EXEMPT_ROLES: ["super_admin", "ceo", "coo", "cfo", "finance", "payroll_head", "finance_head", "accounts_head", "department_head", "hr_head"],
}));
vi.mock("../../../shared/enterpriseScope.js", () => ({
  resolveUserBusinessScope: m.resolveScope,
  canViewEmployee: vi.fn(async () => false),
  buildEmployeeScopeCondition: vi.fn(() => ({ sql: "1=1", params: [] })),
}));
vi.mock("../../../shared/approvalEscalation.js", () => ({ resolveEffectiveApprover: vi.fn(async () => ({ approverId: null })) }));
vi.mock("../leave-policy.service.js", () => ({ leavePolicyService: { getExceptionApproverRole: vi.fn(async () => "branch_head") } }));
vi.mock("../leave.service.js", () => ({ leaveService: {} }));
vi.mock("../leave.controller.js", () => ({
  leaveController: new Proxy({}, { get: (_t, p) => (p === "submitRequest" ? m.submitRequest : vi.fn()) }),
}));

const adminScope = (branchId: string | null) => ({
  userId: "u-admin", roles: ["admin"], employeeId: "emp-admin", branchId,
  assignments: branchId ? [{ roleKey: "admin", scopeType: "branch", branchId }] : [],
});

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.getEmployeeForUser.mockResolvedValue({ id: "emp-admin" });
  m.hasAnyRole.mockImplementation(async (_u: string, ...roles: string[]) => roles.includes("admin"));
  m.hasRole.mockResolvedValue(true);
  m.submitRequest.mockImplementation(async (_req: any, res: any) => res.json({ ok: true }));
});

describe("canReviewLeave", () => {
  const target = (branch: string) => m.execute.mockResolvedValue([[{
    employee_id: "emp-t", status: "pending", leave_type_id: "lt", branch_id: branch, process_id: "p",
    reporting_manager_id: "emp-x", manager_id: "emp-x",
  }]]);

  it("admin may review a request in their own branch", async () => {
    target("b1"); m.resolveScope.mockResolvedValue(adminScope("b1"));
    const { canReviewLeave } = await import("../leave.secure.routes.js");
    expect(await canReviewLeave("u-admin", "lr-1")).toBe(true);
  });
  it("admin may NOT review a request in another branch (was: any branch)", async () => {
    target("b2"); m.resolveScope.mockResolvedValue(adminScope("b1"));
    const { canReviewLeave } = await import("../leave.secure.routes.js");
    expect(await canReviewLeave("u-admin", "lr-1")).toBe(false);
  });
  it("admin with no branch is refused (fail closed)", async () => {
    target("b2"); m.resolveScope.mockResolvedValue(adminScope(null));
    const { canReviewLeave } = await import("../leave.secure.routes.js");
    expect(await canReviewLeave("u-admin", "lr-1")).toBe(false);
  });
  it("super_admin still reviews anywhere", async () => {
    target("b2");
    m.hasAnyRole.mockImplementation(async (_u: string, ...roles: string[]) => roles.includes("super_admin"));
    const { canReviewLeave } = await import("../leave.secure.routes.js");
    expect(await canReviewLeave("u-admin", "lr-1")).toBe(true);
    expect(m.resolveScope).not.toHaveBeenCalled();
  });
});

describe("POST /leave/requests for another employee", () => {
  const app = async () => {
    const { leaveRouter } = await import("../leave.routes.js");
    const a = express(); a.use(express.json()); a.use("/leave", leaveRouter); return a;
  };
  const targetBranch = (b: string) => m.execute.mockResolvedValue([[{ id: "emp-t", branch_id: b, process_id: "p", reporting_manager_id: null }]]);

  it("admin filing for an employee in another branch is 403 and nothing is submitted", async () => {
    m.resolveScope.mockResolvedValue(adminScope("b1")); targetBranch("b2");
    const res = await request(await app()).post("/leave/requests").send({ employeeId: "emp-t" });
    expect(res.status).toBe(403);
    expect(m.submitRequest).not.toHaveBeenCalled();
  });
  it("admin filing for an employee in their own branch passes", async () => {
    m.resolveScope.mockResolvedValue(adminScope("b1")); targetBranch("b1");
    const res = await request(await app()).post("/leave/requests").send({ employeeId: "emp-t" });
    expect(res.status).toBe(200);
    expect(m.submitRequest).toHaveBeenCalled();
  });
  it("filing for yourself needs no scope lookup", async () => {
    const res = await request(await app()).post("/leave/requests").send({ employeeId: "emp-admin" });
    expect(res.status).toBe(200);
    expect(m.resolveScope).not.toHaveBeenCalled();
  });
});
