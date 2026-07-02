import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../src/db/supabaseAdmin.js", () => ({
  supabaseAdmin: {},
  supabaseAuthClient: { auth: { getUser: vi.fn() } },
}));
vi.mock("../src/db/mysql.js", () => ({ db: { execute: vi.fn().mockResolvedValue([[], []]) }, pingDb: vi.fn() }));
vi.mock("../src/modules/employees/employee.service.js", () => ({
  employeeService: {
    createEmployee: vi.fn(),
    getEmployee: vi.fn(),
    listEmployees: vi.fn(),
    updateEmployee: vi.fn(),
    deactivateEmployee: vi.fn(),
  },
}));
vi.mock("../src/middleware/requireRole.js", () => ({
  requireRole: (..._roles: string[]) => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../src/shared/scopeAccess.js", () => ({
  hasScopedAccess: vi.fn().mockResolvedValue(true),
  hasAnyRole: vi.fn().mockResolvedValue(true),
  getUserRoleKeys: vi.fn().mockResolvedValue(["admin", "hr"]),
  getUserAssignmentScopes: vi.fn().mockResolvedValue([]),
  getRosterPlanScope: vi.fn().mockResolvedValue({ branchId: null, processId: null }),
  getEmployeeForUser: vi.fn().mockResolvedValue({ id: "emp-1", employee_code: "EMP001" }),
  getUserRoles: vi.fn().mockResolvedValue([{ role_key: "admin" }]),
  hasRole: vi.fn().mockResolvedValue(true),
  buildScopeWhereClause: vi.fn().mockReturnValue({ where: "", params: [] }),
  AccessDeniedError: class AccessDeniedError extends Error {},
  BadRequestAccessError: class BadRequestAccessError extends Error {},
}));
vi.mock("../src/shared/accessGuard.js", () => ({
  hasRole: vi.fn().mockResolvedValue(true),
  getEmployeeForUser: vi.fn().mockResolvedValue({ id: "emp-1", employee_code: "EMP001" }),
  selfOrAdminHr: (_param?: string) => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../src/middleware/scopeMiddleware.js", () => ({
  requireScopedRole: () => (_req: any, _res: any, next: any) => next(),
  requireScopedAccess: () => (_req: any, _res: any, next: any) => next(),
  requireQueryScope: () => (_req: any, _res: any, next: any) => next(),
  requireBodyScope: () => (_req: any, _res: any, next: any) => next(),
  requireRosterPlanScope: () => (_req: any, _res: any, next: any) => next(),
  getTargetFromBodyOrQuery: () => ({}),
}));

import { supabaseAuthClient } from "../src/db/supabaseAdmin.js";
import { employeeService } from "../src/modules/employees/employee.service.js";
import { app } from "../src/app.js";

const mockGetUser = supabaseAuthClient.auth.getUser as ReturnType<typeof vi.fn>;
const svc = employeeService as { [K in keyof typeof employeeService]: ReturnType<typeof vi.fn> };
const AUTH = { Authorization: "Bearer valid.token" };

const fakeEmployee = {
  id: "emp-1",
  employee_code: "MCN001",
  first_name: "Ravi",
  full_name: "Ravi Kumar",
  date_of_joining: "2026-01-01",
  salary_start_date: "2026-01-01",
  employment_status: "Active",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1", email: "admin@mcn.com" } }, error: null });
});

describe("POST /api/employees", () => {
  it("creates employee", async () => {
    svc.createEmployee.mockResolvedValueOnce(fakeEmployee);
    const r = await request(app).post("/api/employees").set(AUTH).send({
      employeeCode: "MCN001",
      firstName: "Ravi",
      dateOfJoining: "2026-01-01",
    });
    expect(r.status).toBe(201);
    expect(r.body.data.employee_code).toBe("MCN001");
  });

  it("returns 400 when employeeCode missing", async () => {
    const r = await request(app).post("/api/employees").set(AUTH).send({
      firstName: "Ravi",
      dateOfJoining: "2026-01-01",
    });
    expect(r.status).toBe(400);
  });

  it("returns 400 when dateOfJoining invalid format", async () => {
    const r = await request(app).post("/api/employees").set(AUTH).send({
      employeeCode: "MCN001",
      firstName: "Ravi",
      dateOfJoining: "01-01-2026",
    });
    expect(r.status).toBe(400);
  });

  it("returns 401 without auth", async () => {
    expect((await request(app).post("/api/employees").send({})).status).toBe(401);
  });
});

describe("GET /api/employees", () => {
  it("returns paginated list", async () => {
    svc.listEmployees.mockResolvedValueOnce({ data: [fakeEmployee], total: 1, page: 1, limit: 50 });
    const r = await request(app).get("/api/employees").set(AUTH);
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(1);
    expect(r.body.total).toBe(1);
  });
});

describe("GET /api/employees/:id", () => {
  it("returns employee", async () => {
    svc.getEmployee.mockResolvedValueOnce(fakeEmployee);
    const r = await request(app).get("/api/employees/emp-1").set(AUTH);
    expect(r.status).toBe(200);
    expect(r.body.data.salary_start_date).toBe("2026-01-01");
  });
});

describe("PATCH /api/employees/:id", () => {
  it("updates employee fields", async () => {
    svc.updateEmployee.mockResolvedValueOnce({ ...fakeEmployee, mobile: "8888888888" });
    const r = await request(app).patch("/api/employees/emp-1").set(AUTH).send({ mobile: "8888888888" });
    expect(r.status).toBe(200);
  });

  it("updates salary_start_date", async () => {
    svc.updateEmployee.mockResolvedValueOnce({ ...fakeEmployee, salary_start_date: "2026-02-01" });
    const r = await request(app).patch("/api/employees/emp-1").set(AUTH)
      .send({ salaryStartDate: "2026-02-01" });
    expect(r.status).toBe(200);
    expect(r.body.data.salary_start_date).toBe("2026-02-01");
  });

  it("returns 400 for invalid salaryStartDate format", async () => {
    const r = await request(app).patch("/api/employees/emp-1").set(AUTH)
      .send({ salaryStartDate: "01/02/2026" });
    expect(r.status).toBe(400);
  });
});

describe("DELETE /api/employees/:id", () => {
  it("deactivates employee", async () => {
    svc.deactivateEmployee.mockResolvedValueOnce(undefined);
    const r = await request(app).delete("/api/employees/emp-1").set(AUTH);
    expect(r.status).toBe(204);
  });
});
