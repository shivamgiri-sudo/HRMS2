import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Manual attendance overrides: `admin` passes the payroll gate but is branch-scoped like hr
 * (owner ruling 2026-10-01). Org-wide roles and the payroll roles keep the unfiltered behaviour.
 */
const { execute, hasAnyRole, resolveScope, canViewEmployee } = vi.hoisted(() => ({
  execute: vi.fn(), hasAnyRole: vi.fn(), resolveScope: vi.fn(), canViewEmployee: vi.fn(),
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
vi.mock("../../../shared/scopeAccess.js", () => ({
  hasAnyRole,
  ORG_WIDE_EXEMPT_ROLES: ["super_admin", "ceo", "coo", "cfo", "payroll_head", "finance_head", "accounts_head", "finance"],
}));
vi.mock("../../../shared/enterpriseScope.js", () => ({
  resolveUserBusinessScope: resolveScope,
  buildEmployeeScopeCondition: () => ({ sql: "e.branch_id = ?", params: ["branch-a"] }),
  canViewEmployee,
}));
vi.mock("../../../shared/auditLog.js", () => ({ logSensitiveAction: vi.fn() }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u1" }; next(); },
  requireWriteAccess: (_q: any, _s: any, next: any) => next(),
}));

import { attendanceManualOverrideRouter } from "../attendance.manual-override.routes.js";
const app = () => { const a = express(); a.use(express.json()); a.use("/api/attendance", attendanceManualOverrideRouter); return a; };
const scope = (roles: string[], over: Record<string, unknown> = {}) => ({
  userId: "u1", roles, employeeId: "e-self", employeeCode: "C", branchId: "branch-a", processId: null, lobId: null, departmentId: null,
  isSuperAdmin: false, isAdmin: roles.includes("admin"), isHr: false, isPayroll: false, isFinance: false, assignments: [], ...over,
});
const asRole = (...r: string[]) => hasAnyRole.mockImplementation(async (_u: string, ...want: string[]) => want.some((w) => r.includes(w)));

beforeEach(() => {
  execute.mockReset(); hasAnyRole.mockReset(); resolveScope.mockReset(); canViewEmployee.mockReset().mockResolvedValue(false);
  execute.mockImplementation(async (sql: string) => {
    if (/FROM attendance_manual_override amo\s+LEFT JOIN employees\s+e\s+ON e\.id\s+= amo\.employee_id\s+LEFT JOIN branch_master b\s+ON b\.id\s+= e\.branch_id\s+LEFT JOIN process_master p\s+ON p\.id\s+= e\.process_id\s+LEFT JOIN auth_user creator/.test(sql)) {
      return [[{ id: "o1", employee_id: "emp-b", approval_status: "pending", employee_code: "X" }], []];
    }
    if (/SELECT branch_id, reporting_manager_id FROM employees/.test(sql)) return [[{ branch_id: "branch-b", reporting_manager_id: null }], []];
    if (/FROM employees\s+WHERE id = \? AND active_status = 1/.test(sql)) return [[{ id: "emp-b", employee_code: "X" }], []];
    return [[], []];
  });
});

describe("manual overrides - admin branch scope", () => {
  it("list is limited to the admin's branch", async () => {
    asRole("admin"); resolveScope.mockResolvedValue(scope(["admin"]));
    const res = await request(app()).get("/api/attendance/manual-overrides");
    expect(res.status).toBe(200);
    const [sql, params] = execute.mock.calls[0];
    expect(String(sql)).toContain("e.branch_id = ?");
    expect(params).toContain("branch-a");
  });
  it("list stays unfiltered for payroll_head (org-wide)", async () => {
    asRole("payroll_head"); resolveScope.mockResolvedValue(scope(["payroll_head"]));
    await request(app()).get("/api/attendance/manual-overrides");
    expect(String(execute.mock.calls[0][0])).not.toContain("e.branch_id = ?");
  });
  it("opening an override of another branch is refused", async () => {
    asRole("admin"); resolveScope.mockResolvedValue(scope(["admin"]));
    expect((await request(app()).get("/api/attendance/manual-overrides/o1")).status).toBe(403);
  });
  it("approving / rejecting an override of another branch is refused and nothing is written", async () => {
    asRole("admin"); resolveScope.mockResolvedValue(scope(["admin"]));
    expect((await request(app()).post("/api/attendance/manual-overrides/o1/approve").send({})).status).toBe(403);
    expect((await request(app()).post("/api/attendance/manual-overrides/o1/reject").send({ reason: "a long enough reason" })).status).toBe(403);
    expect(execute.mock.calls.some(([q]) => /^\s*UPDATE/i.test(String(q)))).toBe(false);
  });
  it("creating an override for an employee in another branch is refused", async () => {
    asRole("admin"); resolveScope.mockResolvedValue(scope(["admin"]));
    const res = await request(app()).post("/api/attendance/manual-overrides")
      .send({ employee_id: "emp-b", attendance_date: "2026-09-01", new_status: "present", reason: "a long enough reason" });
    expect(res.status).toBe(403);
    expect(execute.mock.calls.some(([q]) => /INSERT/i.test(String(q)))).toBe(false);
  });
  it("an admin whose scope covers the employee (same branch) is allowed through the guard", async () => {
    asRole("admin"); resolveScope.mockResolvedValue(scope(["admin"]));
    canViewEmployee.mockResolvedValue(true);
    expect((await request(app()).get("/api/attendance/manual-overrides/o1")).status).toBe(200);
  });
});
