import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/db/mysql.js", () => ({
  db: { execute: vi.fn().mockResolvedValue([[], []]) },
}));
vi.mock("../src/db/supabaseAdmin.js", () => ({
  supabaseAdmin: {},
  supabaseAuthClient: { auth: { getUser: vi.fn() } },
}));
vi.mock("../src/modules/integration-hub/integration.service.js", () => ({
  integrationService: {
    list: vi.fn(), getByKey: vi.fn(), create: vi.fn(), update: vi.fn(),
    listRuns: vi.fn(), createRun: vi.fn(), listFieldMaps: vi.fn(),
    confirmFieldMap: vi.fn(), listSuggestions: vi.fn(),
    getSchedule: vi.fn(), upsertSchedule: vi.fn(),
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
vi.mock("../src/middleware/scopeMiddleware.js", () => ({
  requireScopedRole: () => (_req: any, _res: any, next: any) => next(),
  requireScopedAccess: () => (_req: any, _res: any, next: any) => next(),
  requireQueryScope: () => (_req: any, _res: any, next: any) => next(),
  requireBodyScope: () => (_req: any, _res: any, next: any) => next(),
  requireRosterPlanScope: () => (_req: any, _res: any, next: any) => next(),
  getTargetFromBodyOrQuery: () => ({}),
}));

import request from "supertest";
import { supabaseAuthClient } from "../src/db/supabaseAdmin.js";
import { integrationService } from "../src/modules/integration-hub/integration.service.js";
import { app } from "../src/app.js";

const mockGetUser = supabaseAuthClient.auth.getUser as ReturnType<typeof vi.fn>;
const svc = integrationService as { [K in keyof typeof integrationService]: ReturnType<typeof vi.fn> };

const AUTH = { Authorization: "Bearer mock-token-admin" };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-1", email: "admin@mcn.com" } }, error: null });
});

const fakeSchedule = {
  id: "sched-1",
  integration_key: "dialer_1",
  cron_expression: "0 */15 * * * *",
  enabled: 0,
  last_run_at: null,
  next_run_at: null,
};

describe("GET /api/integration-hub/:key/schedule", () => {
  it("returns schedule for integration", async () => {
    svc.getSchedule.mockResolvedValueOnce(fakeSchedule);
    const res = await request(app).get("/api/integration-hub/dialer_1/schedule").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.data.cron_expression).toBe("0 */15 * * * *");
  });

  it("returns 401 without auth", async () => {
    const res = await request(app).get("/api/integration-hub/dialer_1/schedule");
    expect(res.status).toBe(401);
  });
});

describe("PUT /api/integration-hub/:key/schedule", () => {
  it("updates schedule and returns it", async () => {
    svc.upsertSchedule.mockResolvedValueOnce({ ...fakeSchedule, cron_expression: "0 0 * * *", enabled: 1 });
    const res = await request(app)
      .put("/api/integration-hub/dialer_1/schedule")
      .set(AUTH)
      .send({ cronExpression: "0 0 * * *", enabled: true });
    expect(res.status).toBe(200);
    expect(res.body.data.enabled).toBe(1);
  });

  it("returns 400 for invalid cron", async () => {
    const res = await request(app)
      .put("/api/integration-hub/dialer_1/schedule")
      .set(AUTH)
      .send({ cronExpression: "not-a-cron" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when body empty", async () => {
    const res = await request(app)
      .put("/api/integration-hub/dialer_1/schedule")
      .set(AUTH)
      .send({});
    expect(res.status).toBe(400);
  });
});
