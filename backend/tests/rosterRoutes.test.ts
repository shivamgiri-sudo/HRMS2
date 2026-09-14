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
vi.mock("../src/modules/wfm/roster.service.js", () => ({
  rosterService: {
    createPlan: vi.fn(),
    listPlans: vi.fn(),
    publishPlan: vi.fn(),
    assignEmployee: vi.fn(),
    bulkAssign: vi.fn(),
    listAssignments: vi.fn(),
  },
}));
vi.mock("../src/modules/wfm/rosterCsvParser.js", () => ({
  parseRosterCsv: vi.fn(),
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
vi.mock("../src/middleware/scopeMiddleware.js", () => ({
  requireScopedRole: () => (_req: any, _res: any, next: any) => next(),
  requireScopedAccess: () => (_req: any, _res: any, next: any) => next(),
  requireQueryScope: () => (_req: any, _res: any, next: any) => next(),
  requireBodyScope: () => (_req: any, _res: any, next: any) => next(),
  requireRosterPlanScope: () => (_req: any, _res: any, next: any) => next(),
  getTargetFromBodyOrQuery: () => ({}),
}));

import { supabaseAuthClient } from "../src/db/supabaseAdmin.js";
import { rosterService } from "../src/modules/wfm/roster.service.js";
import { parseRosterCsv } from "../src/modules/wfm/rosterCsvParser.js";
import { app } from "../src/app.js";

const mockGetUser = supabaseAuthClient.auth.getUser as ReturnType<typeof vi.fn>;
const svc = rosterService as { [K in keyof typeof rosterService]: ReturnType<typeof vi.fn> };
const mockParseCsv = parseRosterCsv as ReturnType<typeof vi.fn>;

const AUTH = { Authorization: "Bearer mock-token-admin" };

const fakePlan = {
  id: "plan-1", plan_name: "May Week 1", process_id: "proc-1", branch_id: null,
  shift_id: "shift-1", from_date: "2026-05-20", to_date: "2026-05-26",
  required_headcount: 10, assigned_headcount: 0, plan_status: "draft",
  created_by: "user-1", created_at: "2026-05-01T00:00:00Z", updated_at: "2026-05-01T00:00:00Z",
};

const fakeAssignment = {
  id: "asgn-1", employee_id: "emp-1", shift_id: "shift-1", plan_id: "plan-1",
  roster_date: "2026-05-20", roster_status: "Rostered",
  shift_start_time: "09:00", shift_end_time: "18:00",
  branch_name: "Mumbai", process_name: "Inbound", publish_status: "draft",
  created_at: "2026-05-01T00:00:00Z", updated_at: "2026-05-01T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1", email: "mgr@mcn.com" } }, error: null });
});

// ─── Plans ─────────────────────────────────────────────────────────────────

describe("POST /api/wfm/roster/plans", () => {
  it("creates a plan and returns 201", async () => {
    svc.createPlan.mockResolvedValueOnce(fakePlan);
    const res = await request(app)
      .post("/api/wfm/roster/plans")
      .set(AUTH)
      .send({ planName: "May Week 1", fromDate: "2026-05-20", toDate: "2026-05-26", requiredHeadcount: 10 });
    expect(res.status).toBe(201);
    expect(res.body.data.plan_name).toBe("May Week 1");
  });

  it("returns 400 when planName missing", async () => {
    const res = await request(app)
      .post("/api/wfm/roster/plans")
      .set(AUTH)
      .send({ fromDate: "2026-05-20", toDate: "2026-05-26" });
    expect(res.status).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const res = await request(app).post("/api/wfm/roster/plans").send({});
    expect(res.status).toBe(401);
  });
});

describe("GET /api/wfm/roster/plans", () => {
  it("returns list of plans", async () => {
    svc.listPlans.mockResolvedValueOnce([fakePlan]);
    const res = await request(app).get("/api/wfm/roster/plans").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe("PATCH /api/wfm/roster/plans/:id/publish", () => {
  it("publishes plan", async () => {
    svc.publishPlan.mockResolvedValueOnce({ ...fakePlan, plan_status: "published" });
    const res = await request(app).patch("/api/wfm/roster/plans/plan-1/publish").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.data.plan_status).toBe("published");
  });
});

// ─── Assignments ────────────────────────────────────────────────────────────

describe("POST /api/wfm/roster/assignments", () => {
  it("creates an assignment and returns 201", async () => {
    svc.assignEmployee.mockResolvedValueOnce(fakeAssignment);
    const res = await request(app)
      .post("/api/wfm/roster/assignments")
      .set(AUTH)
      .send({ employeeId: "550e8400-e29b-41d4-a716-446655440001", rosterDate: "2026-05-20", shiftStartTime: "09:00", shiftEndTime: "18:00" });
    expect(res.status).toBe(201);
    expect(res.body.data.employee_id).toBe("emp-1");
  });

  it("returns 400 when employeeId missing", async () => {
    const res = await request(app)
      .post("/api/wfm/roster/assignments")
      .set(AUTH)
      .send({ rosterDate: "2026-05-20" });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/wfm/roster/assignments", () => {
  it("returns assignments", async () => {
    svc.listAssignments.mockResolvedValueOnce([fakeAssignment]);
    const res = await request(app).get("/api/wfm/roster/assignments?planId=550e8400-e29b-41d4-a716-446655440001").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

// ─── CSV Upload ─────────────────────────────────────────────────────────────

describe("POST /api/wfm/roster/upload", () => {
  it("returns 400 when no file attached", async () => {
    const res = await request(app)
      .post("/api/wfm/roster/upload?planId=plan-1")
      .set(AUTH);
    expect(res.status).toBe(400);
  });

  it("returns 400 when planId missing", async () => {
    const res = await request(app)
      .post("/api/wfm/roster/upload")
      .set(AUTH)
      .attach("file", Buffer.from("employee_code,roster_date\n"), "roster.csv");
    expect(res.status).toBe(400);
  });

  it("processes valid CSV and returns summary", async () => {
    mockParseCsv.mockReturnValueOnce({
      rows: [
        { employee_code: "EMP001", roster_date: "2026-05-20", shift_start_time: "09:00", shift_end_time: "18:00", process_name: "Inbound", branch_name: "Mumbai" },
      ],
      errors: [],
    });
    svc.bulkAssign.mockResolvedValueOnce({ assigned: 1, failed: 0, errors: [] });

    const res = await request(app)
      .post("/api/wfm/roster/upload?planId=plan-1")
      .set(AUTH)
      .attach("file", Buffer.from("employee_code,roster_date,shift_start_time,shift_end_time\nEMP001,2026-05-20,09:00,18:00"), "roster.csv");

    expect(res.status).toBe(200);
    expect(res.body.assigned).toBe(1);
    expect(res.body.failed).toBe(0);
  });

  it("returns 422 with parse errors when CSV has invalid rows", async () => {
    mockParseCsv.mockReturnValueOnce({
      rows: [],
      errors: ["Row 1: employee_code is required"],
    });

    const res = await request(app)
      .post("/api/wfm/roster/upload?planId=plan-1")
      .set(AUTH)
      .attach("file", Buffer.from(",2026-05-20,09:00,18:00"), "roster.csv");

    expect(res.status).toBe(422);
    expect(res.body.errors).toHaveLength(1);
  });
});
