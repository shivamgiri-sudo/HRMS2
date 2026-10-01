import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../src/db/supabaseAdmin.js", () => ({
  supabaseAdmin: {},
  supabaseAuthClient: { auth: { getUser: vi.fn() } },
}));
// The manager weekoff-review overrides write their state change and audit row in one
// transaction (inManagerDecisionTx), so the mock pool hands out a connection. Its
// statements go through the same execute mock so SQL-matched stubs cover both paths.
const { txConn } = vi.hoisted(() => ({
  txConn: {
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
  },
}));
vi.mock("../src/db/mysql.js", () => {
  const execute = vi.fn().mockResolvedValue([[], []]);
  return {
    db: {
      execute,
      getConnection: vi.fn(async () => ({ ...txConn, execute: (...args: unknown[]) => execute(...args) })),
    },
    pingDb: vi.fn(),
  };
});
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
  ORG_WIDE_EXEMPT_ROLES: ["super_admin", "ceo", "coo", "cfo", "payroll_head", "finance_head", "accounts_head", "finance"],
  // role lookup used by enterpriseScope (user_roles + the synthetic department_head role)
  USER_ROLES_WITH_DEPARTMENT_HEAD_SQL: "SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1",
  DEPARTMENT_HEAD_ROLES: [],
  hasOrgWideScope: vi.fn().mockResolvedValue(true),
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
import { db } from "../src/db/mysql.js";
import { wfmService } from "../src/modules/wfm/wfm.service.js";
import { app } from "../src/app.js";

const mockGetUser = supabaseAuthClient.auth.getUser as ReturnType<typeof vi.fn>;
const mockExecute = db.execute as ReturnType<typeof vi.fn>;
const svc = wfmService as { [K in keyof typeof wfmService]: ReturnType<typeof vi.fn> };
const AUTH = { Authorization: "Bearer mock-token-admin" };

const fakeShift = { id: "shift-1", shift_code: "GEN", shift_name: "General", start_time: "09:00", end_time: "18:00", required_minutes: 540, active_status: 1 };
const fakeSession = { id: "sess-1", employee_id: "emp-1", session_date: "2026-05-21", current_status: "Logged In" };
// Regularization is refused for dates older than 90 days (and for future dates), so a
// fixed calendar date goes stale. Yesterday is always inside the window.
const RECENT_DATE = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const fakeReg = { id: "reg-1", employee_id: "emp-1", session_date: RECENT_DATE, status: "pending" };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1", email: "admin@mcn.com" } }, error: null });

  // /api/wfm/regularizations is served by wfmRegularizationSecureRouter, which
  // app.ts mounts BEFORE wfmRouter on the same base — so those paths never reach
  // wfmService and its mocks are not consulted. The secure handlers build their
  // own SQL, so the rows come through the db mock. Matched on statement rather
  // than call order, since the handlers issue a varying number of queries.
  mockExecute.mockImplementation(async (sql: unknown) => {
    const text = String(sql);
    // Anchored: the review pre-read selects the regularization row and carries COUNT(*)
    // only in correlated subqueries, so an unanchored match would answer it with a total.
    if (/^\s*SELECT\s+COUNT\(\*\)/i.test(text)) return [[{ total: 1 }], []];
    if (/attendance_regularization/i.test(text)) return [[fakeReg], []];
    return [[], []];
  });
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
      sessionDate: RECENT_DATE,
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

// Part A.3 (2026-08-13): the 4 manager-override actions previously mutated
// wfm_roster_assignment with no check on whether attendance for that date was
// already locked for payroll. These lock the SELECT ... adr.is_locked query
// each handler now runs before its UPDATE, so a real "locked" answer blocks
// with 409 and a false/absent answer leaves the pre-existing success path
// (200) unchanged.
describe("Manager weekoff-review overrides — attendance-lock guard (Part A.3)", () => {
  const isLockCheckSql = (sql: string) => /SELECT adr\.is_locked/i.test(sql);

  function mockAttendanceLocked(locked: boolean) {
    mockExecute.mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (isLockCheckSql(text)) return [[{ is_locked: locked ? 1 : 0 }], []];
      if (/COUNT\(\*\)/i.test(text)) return [[{ total: 1 }], []];
      return [[], []];
    });
  }

  const ENDPOINTS: Array<{ name: string; path: string; body: Record<string, unknown> }> = [
    { name: "realign", path: "/api/wfm/manager/weekoff-review/assign-1/realign", body: { reason: "shift change", new_roster_date: "2026-05-22" } },
    { name: "force-approve", path: "/api/wfm/manager/weekoff-review/assign-1/force-approve", body: { reason: "approve as requested" } },
    { name: "escalate", path: "/api/wfm/manager/weekoff-review/assign-1/escalate", body: { reason: "needs HR review" } },
    { name: "reject-request", path: "/api/wfm/manager/weekoff-review/assign-1/reject-request", body: { reason: "not eligible" } },
  ];

  for (const { name, path, body } of ENDPOINTS) {
    it(`${name}: returns 409 when attendance for the assignment's date is already locked`, async () => {
      mockAttendanceLocked(true);
      const r = await request(app).post(path).set(AUTH).send(body);
      expect(r.status).toBe(409);
      expect(r.body.error).toMatch(/locked/i);
    });

    it(`${name}: proceeds to 200 as before when attendance is not locked`, async () => {
      mockAttendanceLocked(false);
      const r = await request(app).post(path).set(AUTH).send(body);
      expect(r.status).toBe(200);
      expect(r.body.success).toBe(true);
      // The decision and its audit row commit together and the connection goes back.
      expect(txConn.commit).toHaveBeenCalledTimes(1);
      expect(txConn.rollback).not.toHaveBeenCalled();
      expect(txConn.release).toHaveBeenCalledTimes(1);
    });

    it(`${name}: still requires reason before any lock check runs`, async () => {
      mockAttendanceLocked(true);
      const r = await request(app).post(path).set(AUTH).send({});
      expect(r.status).toBe(400);
    });
  }
});
