import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Attendance disputes: admin is branch-scoped like hr / wfm (owner ruling 2026-10-01). Only super_admin / ceo / coo / cfo
 * are unfiltered. admin / hr / wfm may act on a dispute (manager-action, hr-action) only for employees inside their scope.
 */
const h = vi.hoisted(() => ({
  execute: vi.fn(), hasAnyRole: vi.fn(), resolveScope: vi.fn(), canViewEmployee: vi.fn(), review: vi.fn(),
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: h.execute } }));
vi.mock("../../../shared/scopeAccess.js", () => ({
  hasAnyRole: h.hasAnyRole, hasScopedAccess: vi.fn(async () => false), buildScopeWhereClause: vi.fn(async () => ({ sql: "1=0", params: [] })),
  ORG_WIDE_EXEMPT_ROLES: ["super_admin", "ceo", "coo", "cfo", "payroll_head", "finance_head", "accounts_head", "finance"],
}));
vi.mock("../../../shared/accessGuard.js", () => ({ getEmployeeForUser: vi.fn(async () => ({ id: "emp-me" })) }));
vi.mock("../../../shared/enterpriseScope.js", () => ({
  resolveUserBusinessScope: h.resolveScope,
  buildEmployeeScopeCondition: () => ({ sql: "e.branch_id = ?", params: ["branch-a"] }),
  canViewEmployee: h.canViewEmployee,
}));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn() }));
vi.mock("../../../shared/approvalEscalation.js", () => ({ resolveEffectiveApprover: vi.fn(async () => ({ approverId: null })) }));
vi.mock("../../wfm/wfm.service.js", () => ({ wfmService: { reviewRegularization: h.review } }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u1" }; next(); },
}));

import { attendanceDisputeRouter } from "../attendance.dispute.routes.js";
const app = () => { const a = express(); a.use(express.json()); a.use("/api/attendance", attendanceDisputeRouter); return a; };
const asRoles = (...r: string[]) => h.hasAnyRole.mockImplementation(async (_u: string, ...want: string[]) => r.includes("super_admin") || want.some((w) => r.includes(w)));
const scope = (roles: string[]) => ({
  userId: "u1", roles, employeeId: "emp-me", employeeCode: "C", branchId: "branch-a", processId: null, lobId: null, departmentId: null,
  isSuperAdmin: false, isAdmin: roles.includes("admin"), isHr: false, isPayroll: false, isFinance: false, assignments: [],
});
const DISPUTE = { id: "d1", employee_id: "emp-b", status: "pending", payroll_impact: 0, payroll_head_approval_required: 0, session_date: "2026-09-01" };

beforeEach(() => {
  vi.clearAllMocks();
  h.canViewEmployee.mockResolvedValue(false);
  h.execute.mockImplementation(async (sql: string) => {
    if (/FROM attendance_regularization ar\s+LEFT JOIN employees e\s+ON e\.id\s+= ar\.employee_id\s+LEFT JOIN branch_master b\s+ON b\.id\s+= COALESCE\(ar\.branch_id, e\.branch_id\)\s+LEFT JOIN process_master p\s+ON p\.id\s+= e\.process_id\s+LEFT JOIN attendance_reason_master arm ON arm\.code = ar\.reason_code\s+LEFT JOIN attendance_daily_record/.test(sql)) return [[DISPUTE], []];
    if (/SELECT branch_id, reporting_manager_id FROM employees/.test(sql)) return [[{ branch_id: "branch-b", reporting_manager_id: null }], []];
    return [[], []];
  });
});

describe("GET /disputes list scope", () => {
  it("admin is limited to its own branch (like hr)", async () => {
    asRoles("admin"); h.resolveScope.mockResolvedValue(scope(["admin"]));
    await request(app()).get("/api/attendance/disputes");
    const [sql, params] = h.execute.mock.calls.find(([q]) => /FROM attendance_regularization ar/.test(String(q)) && /LIMIT 200/.test(String(q)))!;
    expect(String(sql)).toContain("e.branch_id = ?");
    expect(params).toContain("branch-a");
  });
  it("super_admin / ceo stay unfiltered", async () => {
    asRoles("ceo"); h.resolveScope.mockResolvedValue(scope(["ceo"]));
    await request(app()).get("/api/attendance/disputes");
    const [sql] = h.execute.mock.calls.find(([q]) => /LIMIT 200/.test(String(q)))!;
    expect(String(sql)).toContain("(1=1)");
  });
});

describe("dispute actions are scoped for admin / hr / wfm", () => {
  it("hr-action: admin is refused for another branch's employee and nothing is written", async () => {
    asRoles("admin"); h.resolveScope.mockResolvedValue(scope(["admin"]));
    const res = await request(app()).post("/api/attendance/disputes/d1/hr-action").send({ action: "approve", reason: "ok then" });
    expect(res.status).toBe(403);
    expect(h.review).not.toHaveBeenCalled();
  });
  it("hr-action: admin may act inside its scope", async () => {
    asRoles("admin"); h.resolveScope.mockResolvedValue(scope(["admin"]));
    h.canViewEmployee.mockResolvedValue(true);
    const res = await request(app()).post("/api/attendance/disputes/d1/hr-action").send({ action: "approve", reason: "ok then" });
    expect(res.status).not.toBe(403);
    expect(h.review).toHaveBeenCalled();
  });
  it("hr-action: an org-wide caller may act on any branch", async () => {
    asRoles("ceo"); h.resolveScope.mockResolvedValue(scope(["ceo"]));
    const res = await request(app()).post("/api/attendance/disputes/d1/hr-action").send({ action: "approve", reason: "ok then" });
    expect(res.status).not.toBe(403);
    expect(h.review).toHaveBeenCalled();
  });
  it("manager-action: admin / hr no longer skip the scope check", async () => {
    asRoles("admin"); h.resolveScope.mockResolvedValue(scope(["admin"]));
    const res = await request(app()).post("/api/attendance/disputes/d1/manager-action").send({ action: "approve" });
    expect(res.status).toBe(403);
    expect(h.review).not.toHaveBeenCalled();
  });
});
