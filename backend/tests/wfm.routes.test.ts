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
vi.mock("../src/modules/wfm/wfm.service.js", () => ({
  wfmService: {
    listShifts: vi.fn(),
    getShift: vi.fn(),
    createShift: vi.fn(),
    updateShift: vi.fn(),
    clockIn: vi.fn(),
    clockOut: vi.fn(),
    listSessions: vi.fn(),
    logBreak: vi.fn(),
    submitRegularization: vi.fn(),
    reviewRegularization: vi.fn(),
    listRegularizations: vi.fn(),
  },
}));
vi.mock("../src/middleware/requireRole.js", () => ({
  requireRole: (..._roles: string[]) => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../src/shared/accessGuard.js", () => ({
  getEmployeeForUser: vi.fn().mockResolvedValue({ id: "emp-1", employee_code: "EMP001" }),
  hasRole: vi.fn().mockResolvedValue(true),
  hasProcessScope: vi.fn().mockResolvedValue(true),
  selfOrAdminHr: () => (_req: any, _res: any, next: any) => next(),
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
vi.mock("../src/middleware/scopeMiddleware.js", () => ({
  requireScopedRole: () => (_req: any, _res: any, next: any) => next(),
  requireScopedAccess: () => (_req: any, _res: any, next: any) => next(),
  requireQueryScope: () => (_req: any, _res: any, next: any) => next(),
  requireBodyScope: () => (_req: any, _res: any, next: any) => next(),
  requireRosterPlanScope: () => (_req: any, _res: any, next: any) => next(),
  getTargetFromBodyOrQuery: () => ({}),
}));

import { supabaseAuthClient } from "../src/db/supabaseAdmin.js";
import { wfmService } from "../src/modules/wfm/wfm.service.js";
import { app } from "../src/app.js";

const mockGetUser = supabaseAuthClient.auth.getUser as ReturnType<typeof vi.fn>;
const svc = wfmService as { [K in keyof typeof wfmService]: ReturnType<typeof vi.fn> };
const AUTH = { Authorization: "Bearer valid.token" };

const fakeShift = { id: "shift-1", shift_code: "GEN", shift_name: "General", start_time: "09:00", end_time: "18:00", required_minutes: 540, active_status: 1 };
const fakeSession = { id: "sess-1", employee_id: "emp-1", session_date: "2026-05-21", current_status: "Logged In" };
const fakeReg = { id: "reg-1", employee_id: "emp-1", session_date: "2026-05-20", status: "pending" };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1", email: "admin@mcn.com" } }, error: null });
});

describe("GET /api/wfm/shifts", () => {
  it("returns shifts list", async () => {
    svc.listShifts.mockResolvedValueOnce([fakeShift]);
    const r = await request(app).get("/api/wfm/shifts").set(AUTH);
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(1);
  });
  it("returns 401 without auth", async () => {
    const r = await request(app).get("/api/wfm/shifts");
    expect(r.status).toBe(401);
  });
});

describe("GET /api/wfm/shifts/:id", () => {
  it("returns shift", async () => {
    svc.getShift.mockResolvedValueOnce(fakeShift);
    const r = await request(app).get("/api/wfm/shifts/shift-1").set(AUTH);
    expect(r.status).toBe(200);
    expect(r.body.data.shift_code).toBe("GEN");
  });
});

describe("POST /api/wfm/shifts", () => {
  it("creates shift", async () => {
    svc.createShift.mockResolvedValueOnce(fakeShift);
    const r = await request(app).post("/api/wfm/shifts").set(AUTH)
      .send({ shiftCode: "GEN", shiftName: "General", startTime: "09:00", endTime: "18:00" });
    expect(r.status).toBe(201);
  });
  it("returns 400 for invalid time format", async () => {
    const r = await request(app).post("/api/wfm/shifts").set(AUTH)
      .send({ shiftCode: "GEN", shiftName: "General", startTime: "9am", endTime: "18:00" });
    expect(r.status).toBe(400);
  });
});

describe("PUT /api/wfm/shifts/:id", () => {
  it("updates shift", async () => {
    svc.updateShift.mockResolvedValueOnce({ ...fakeShift, shift_name: "Night" });
    const r = await request(app).put("/api/wfm/shifts/shift-1").set(AUTH)
      .send({ shiftName: "Night" });
    expect(r.status).toBe(200);
    expect(r.body.data.shift_name).toBe("Night");
  });
});

describe("POST /api/wfm/sessions/clock-in", () => {
  it("clocks in", async () => {
    svc.clockIn.mockResolvedValueOnce(fakeSession);
    const r = await request(app).post("/api/wfm/sessions/clock-in").set(AUTH)
      .send({ employeeId: "550e8400-e29b-41d4-a716-446655440000", sessionDate: "2026-05-21", punchSource: "MANUAL" });
    expect(r.status).toBe(201);
  });
  it("returns 400 for invalid punchSource", async () => {
    const r = await request(app).post("/api/wfm/sessions/clock-in").set(AUTH)
      .send({ employeeId: "550e8400-e29b-41d4-a716-446655440000", sessionDate: "2026-05-21", punchSource: "UNKNOWN" });
    expect(r.status).toBe(400);
  });
});

describe("POST /api/wfm/sessions/clock-out", () => {
  it("clocks out", async () => {
    svc.clockOut.mockResolvedValueOnce({ ...fakeSession, current_status: "Logged Out" });
    const r = await request(app).post("/api/wfm/sessions/clock-out").set(AUTH)
      .send({ sessionId: "550e8400-e29b-41d4-a716-446655440000" });
    expect(r.status).toBe(200);
    expect(r.body.data.current_status).toBe("Logged Out");
  });
  it("returns 400 when sessionId missing", async () => {
    const r = await request(app).post("/api/wfm/sessions/clock-out").set(AUTH).send({});
    expect(r.status).toBe(400);
  });
});

describe("GET /api/wfm/sessions", () => {
  it("returns paginated sessions", async () => {
    svc.listSessions.mockResolvedValueOnce({ data: [fakeSession], total: 1, page: 1, limit: 20 });
    const r = await request(app).get("/api/wfm/sessions").set(AUTH);
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(1);
  });
});

describe("POST /api/wfm/regularizations", () => {
  it("submits regularization", async () => {
    svc.submitRegularization.mockResolvedValueOnce(fakeReg);
    const r = await request(app).post("/api/wfm/regularizations").set(AUTH).send({
      employeeId: "550e8400-e29b-41d4-a716-446655440000",
      sessionDate: "2026-05-20",
      reason: "Was present",
    });
    expect(r.status).toBe(201);
  });
  it("returns 400 when reason is empty", async () => {
    const r = await request(app).post("/api/wfm/regularizations").set(AUTH).send({
      employeeId: "550e8400-e29b-41d4-a716-446655440000",
      sessionDate: "2026-05-20",
      reason: "",
    });
    expect(r.status).toBe(400);
  });
});

describe("GET /api/wfm/regularizations", () => {
  it("returns regularizations list", async () => {
    svc.listRegularizations.mockResolvedValueOnce([fakeReg]);
    const r = await request(app).get("/api/wfm/regularizations").set(AUTH);
    expect(r.status).toBe(200);
    expect(r.body.data).toHaveLength(1);
  });
});

describe("PATCH /api/wfm/regularizations/:id/review", () => {
  it("approves regularization", async () => {
    svc.reviewRegularization.mockResolvedValueOnce({ ...fakeReg, status: "approved" });
    const r = await request(app).patch("/api/wfm/regularizations/reg-1/review").set(AUTH)
      .send({ status: "approved" });
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe("approved");
  });
  it("returns 400 for invalid status", async () => {
    const r = await request(app).patch("/api/wfm/regularizations/reg-1/review").set(AUTH)
      .send({ status: "pending" });
    expect(r.status).toBe(400);
  });
});
