import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../src/db/supabaseAdmin.js", () => ({
  supabaseAdmin: {},
  supabaseAuthClient: { auth: { getUser: vi.fn() } },
}));
vi.mock("../src/db/mysql.js", () => ({
  db: { execute: vi.fn().mockResolvedValue([[], []]) },
  pingDb: vi.fn(),
}));
vi.mock("../src/modules/leave/leave.service.js", () => ({
  leaveService: {
    listLeaveTypes: vi.fn(),
    createLeaveType: vi.fn(),
    submitRequest: vi.fn(),
    getRequest: vi.fn(),
    reviewRequest: vi.fn(),
    listRequests: vi.fn(),
    getBalance: vi.fn(),
    listHolidays: vi.fn(),
    createHoliday: vi.fn(),
  },
}));
vi.mock("../src/middleware/requireRole.js", () => ({
  requireRole: (..._roles: string[]) => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../src/shared/scopeAccess.js", () => ({
  hasScopedAccess: vi.fn().mockResolvedValue(true),
  hasAnyRole: vi.fn().mockResolvedValue(true),
  isOrgWideUser: vi.fn().mockResolvedValue(true),
  getUserRoleKeys: vi.fn().mockResolvedValue(["admin", "hr"]),
  getUserAssignmentScopes: vi.fn().mockResolvedValue([]),
  getRosterPlanScope: vi.fn().mockResolvedValue({ branchId: null, processId: null }),
  getEmployeeForUser: vi.fn().mockResolvedValue({ id: "emp-1", employee_code: "EMP001" }),
  getUserRoles: vi.fn().mockResolvedValue([{ role_key: "admin" }]),
  hasRole: vi.fn().mockResolvedValue(true),
  buildScopeWhereClause: vi.fn().mockReturnValue({ where: "", params: [] }),
  ORG_WIDE_EXEMPT_ROLES: ["super_admin", "ceo", "coo", "cfo", "payroll_head", "finance_head", "accounts_head", "finance"],
  // role lookup used by enterpriseScope (user_roles + the synthetic department_head role)
  USER_ROLES_WITH_DEPARTMENT_HEAD_SQL: "SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1",
  DEPARTMENT_HEAD_ROLES: [],
  AccessDeniedError: class AccessDeniedError extends Error {},
  BadRequestAccessError: class BadRequestAccessError extends Error {},
}));
vi.mock("../src/middleware/scopeMiddleware.js", () => ({
  requireScopedRole: () => (_req: any, _res: any, next: any) => next(),
  requireScopedAccess: () => (_req: any, _res: any, next: any) => next(),
  requireQueryScope: () => (_req: any, _res: any, next: any) => next(),
  requireBodyScope: () => (_req: any, _res: any, next: any) => next(),
  requireRosterPlanScope: () => (_req: any, _res: any, next: any) => next(),
  getTargetFromBodyOrQuery: () => ({}),
}));
vi.mock("../src/shared/accessGuard.js", () => ({
  getEmployeeForUser: vi.fn().mockResolvedValue({ id: "emp-1", employee_code: "EMP001" }),
  hasRole: vi.fn().mockResolvedValue(true),
  selfOrAdminHr: () => (_req: any, _res: any, next: any) => next(),
}));

import { supabaseAuthClient } from "../src/db/supabaseAdmin.js";
import { db } from "../src/db/mysql.js";
import { leaveService } from "../src/modules/leave/leave.service.js";
import { app } from "../src/app.js";

const mockGetUser = supabaseAuthClient.auth.getUser as ReturnType<typeof vi.fn>;
const mockExecute = db.execute as ReturnType<typeof vi.fn>;
const svc = leaveService as { [K in keyof typeof leaveService]: ReturnType<typeof vi.fn> };
const AUTH = { Authorization: "Bearer mock-token-admin" };

const fakeType    = { id: "lt-1", leave_code: "CL", leave_name: "Casual Leave" };
const fakeRequest = { id: "lr-1", employee_id: "emp-1", status: "pending" };
const fakeBalance = { id: "bal-1", employee_id: "emp-1", allocated_days: 12, used_days: 0 };
const fakeHoliday = { id: "hol-1", holiday_name: "Diwali", holiday_date: "2026-10-20" };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1", email: "admin@mcn.com" } }, error: null });
  // admin is branch-scoped (owner policy 2026-10-01): the demo admin below is an admin whose own branch is
  // branch-1, so scope-guarded routes admit employees of branch-1 only. Matched on SQL, not call order.
  mockExecute.mockImplementation(async (sql: unknown) => {
    const text = String(sql);
    if (/FROM user_roles/i.test(text)) return [[{ role_key: "admin" }], []];
    if (/FROM user_assignment_scope/i.test(text)) {
      return [[{ role_key: "admin", scope_type: "branch", branch_id: "branch-1" }], []];
    }
    if (/FROM employees\s+WHERE user_id/i.test(text)) {
      return [[{ id: "caller-emp", employee_code: "ADM001", branch_id: "branch-1" }], []];
    }
    if (/FROM employees\s+WHERE id/i.test(text)) {
      return [[{ id: "emp-1", branch_id: "branch-1", process_id: "proc-1", reporting_manager_id: null }], []];
    }
    return [[], []];
  });
});

describe("GET /api/leave/types", () => {
  it("returns leave types", async () => {
    svc.listLeaveTypes.mockResolvedValueOnce([fakeType]);
    const r = await request(app).get("/api/leave/types").set(AUTH);
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(1);
  });
  it("returns 401 without auth", async () => {
    expect((await request(app).get("/api/leave/types")).status).toBe(401);
  });
});

describe("POST /api/leave/types", () => {
  it("creates leave type", async () => {
    svc.createLeaveType.mockResolvedValueOnce(fakeType);
    const r = await request(app).post("/api/leave/types").set(AUTH)
      .send({ leaveCode: "CL", leaveName: "Casual Leave", maxDaysPerYear: 12 });
    expect(r.status).toBe(201);
  });
  it("returns 400 for empty leaveCode", async () => {
    const r = await request(app).post("/api/leave/types").set(AUTH)
      .send({ leaveCode: "", leaveName: "Casual", maxDaysPerYear: 12 });
    expect(r.status).toBe(400);
  });
});

describe("POST /api/leave/requests", () => {
  it("submits leave request", async () => {
    svc.submitRequest.mockResolvedValueOnce(fakeRequest);
    const r = await request(app).post("/api/leave/requests").set(AUTH).send({
      employeeId: "550e8400-e29b-41d4-a716-446655440000",
      leaveTypeId: "550e8400-e29b-41d4-a716-446655440001",
      fromDate: "2026-06-01", toDate: "2026-06-03", totalDays: 3,
    });
    expect(r.status).toBe(201);
  });
  it("returns 400 when toDate before fromDate", async () => {
    const r = await request(app).post("/api/leave/requests").set(AUTH).send({
      employeeId: "550e8400-e29b-41d4-a716-446655440000",
      leaveTypeId: "550e8400-e29b-41d4-a716-446655440001",
      fromDate: "2026-06-05", toDate: "2026-06-01", totalDays: 3,
    });
    expect(r.status).toBe(400);
  });
});

describe("GET /api/leave/requests", () => {
  it("returns paginated requests", async () => {
    // Served by leaveSecureRouter, which app.ts mounts BEFORE leaveRouter on the
    // same /api/leave base — so this path never reaches leaveController and the
    // leaveService.listRequests mock is not consulted. The secure handler builds
    // its own SQL, so the rows are supplied through the db mock instead.
    mockExecute.mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (/COUNT\(\*\)/i.test(text)) return [[{ total: 1 }], []];
      if (/FROM leave_request lr/i.test(text)) return [[fakeRequest], []];
      return [[], []];
    });

    const r = await request(app).get("/api/leave/requests").set(AUTH);

    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(1);
    expect(r.body.total).toBe(1);
  });
});

describe("PATCH /api/leave/requests/:id/review", () => {
  // The review route is leaveSecureRouter's, which authorises every call through
  // canReviewLeave(): it loads the request's row and refuses (403) when the request does not
  // exist or when the caller is the employee who raised it, before any role is consulted. The
  // suite's mocked caller is employee emp-1, so the request under review has to belong to
  // someone else for the privileged (admin/hr) path to apply at all.
  function requestUnderReviewBelongsTo(employeeId: string | null) {
    mockExecute.mockImplementation(async (sql: unknown) => {
      if (/FROM leave_request lr/i.test(String(sql)) && employeeId) {
        return [[{ employee_id: employeeId, status: "pending", leave_type_id: "lt-1" }], []];
      }
      return [[], []];
    });
  }

  it("approves request", async () => {
    requestUnderReviewBelongsTo("emp-2");
    svc.reviewRequest.mockResolvedValueOnce({ ...fakeRequest, employee_id: "emp-2", status: "approved" });
    const r = await request(app).patch("/api/leave/requests/lr-1/review").set(AUTH)
      .send({ status: "approved" });
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe("approved");
    expect(svc.reviewRequest).toHaveBeenCalledWith("lr-1", { status: "approved", remarks: null }, expect.any(String));
  });
  it("returns 400 for invalid status", async () => {
    requestUnderReviewBelongsTo("emp-2");
    const r = await request(app).patch("/api/leave/requests/lr-1/review").set(AUTH)
      .send({ status: "maybe" });
    expect(r.status).toBe(400);
    expect(svc.reviewRequest).not.toHaveBeenCalled();
  });
  it("refuses to let a caller review their own leave request, even as admin/hr", async () => {
    requestUnderReviewBelongsTo("emp-1");
    const r = await request(app).patch("/api/leave/requests/lr-1/review").set(AUTH)
      .send({ status: "approved" });
    expect(r.status).toBe(403);
    expect(svc.reviewRequest).not.toHaveBeenCalled();
  });
  it("refuses a request that does not exist instead of reviewing it", async () => {
    requestUnderReviewBelongsTo(null);
    const r = await request(app).patch("/api/leave/requests/lr-1/review").set(AUTH)
      .send({ status: "approved" });
    expect(r.status).toBe(403);
    expect(svc.reviewRequest).not.toHaveBeenCalled();
  });
});

describe("GET /api/leave/balance/:employeeId", () => {
  it("returns balance for current year by default", async () => {
    svc.getBalance.mockResolvedValueOnce([fakeBalance]);
    const r = await request(app).get("/api/leave/balance/emp-1").set(AUTH);
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(1);
  });
});

describe("GET /api/leave/holidays", () => {
  it("returns holidays", async () => {
    svc.listHolidays.mockResolvedValueOnce([fakeHoliday]);
    const r = await request(app).get("/api/leave/holidays").set(AUTH);
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(1);
  });
});

describe("POST /api/leave/holidays", () => {
  it("creates holiday", async () => {
    svc.createHoliday.mockResolvedValueOnce(fakeHoliday);
    const r = await request(app).post("/api/leave/holidays").set(AUTH)
      .send({ holidayName: "Diwali", holidayDate: "2026-10-20" });
    expect(r.status).toBe(201);
  });
  it("returns 400 for bad date format", async () => {
    const r = await request(app).post("/api/leave/holidays").set(AUTH)
      .send({ holidayName: "X", holidayDate: "20-10-2026" });
    expect(r.status).toBe(400);
  });
});
