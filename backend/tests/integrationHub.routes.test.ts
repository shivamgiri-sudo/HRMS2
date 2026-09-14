import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../src/modules/auth/auth.service.js", () => ({
  authService: {
    verifyAccessToken: vi.fn(() => ({ id: "user-1", email: "admin@mcn.com" })),
  },
}));

vi.mock("../src/db/mysql.js", () => ({
  db: { execute: vi.fn().mockResolvedValue([[], []]) },
  pingDb: vi.fn(),
}));

vi.mock("../src/modules/integration-hub/integration.service.js", () => ({
  integrationService: {
    list: vi.fn(),
    getByKey: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    listRuns: vi.fn(),
    createRun: vi.fn(),
    listFieldMaps: vi.fn(),
    confirmFieldMap: vi.fn(),
    listSuggestions: vi.fn(),
    listTableMaps: vi.fn(),
    upsertTableMap: vi.fn(),
    getMappingCatalog: vi.fn(),
    inspectSourceSchema: vi.fn(),
  },
}));
vi.mock("../src/modules/integration-hub/connectorRunner.js", () => ({
  executeConnector: vi.fn(),
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

import { integrationService } from "../src/modules/integration-hub/integration.service.js";
import { executeConnector } from "../src/modules/integration-hub/connectorRunner.js";
import { app } from "../src/app.js";

const svc = integrationService as { [K in keyof typeof integrationService]: ReturnType<typeof vi.fn> };
const mockExecuteConnector = executeConnector as ReturnType<typeof vi.fn>;

const AUTH = { Authorization: "Bearer mock-token-admin" };

const fakeConfig = {
  id: "cfg-1",
  integration_key: "dialer_1",
  integration_name: "Dialer 1",
  integration_type: "rest_pull",
  vendor_name: null,
  base_url: null,
  auth_type: "api_key",
  secret_name: null,
  config_json: null,
  active_status: 1,
  notes: null,
  created_at: "2026-05-01T00:00:00Z",
  updated_at: "2026-05-01T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── GET /api/integration-hub ──────────────────────────────────────────────────

describe("GET /api/integration-hub", () => {
  it("returns list of integrations", async () => {
    svc.list.mockResolvedValueOnce([fakeConfig]);
    const res = await request(app).get("/api/integration-hub").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
  });

  it("returns 401 without auth", async () => {
    const res = await request(app).get("/api/integration-hub");
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/integration-hub/:key ────────────────────────────────────────────

describe("GET /api/integration-hub/:key", () => {
  it("returns integration by key", async () => {
    svc.getByKey.mockResolvedValueOnce(fakeConfig);
    const res = await request(app).get("/api/integration-hub/dialer_1").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.data.integration_key).toBe("dialer_1");
  });

  it("returns 500 when not found", async () => {
    svc.getByKey.mockRejectedValueOnce(new Error("Integration not found"));
    const res = await request(app).get("/api/integration-hub/missing").set(AUTH);
    expect(res.status).toBe(500);
    expect(res.body.message).toMatch(/not found/i);
  });
});

// ─── POST /api/integration-hub ────────────────────────────────────────────────

describe("POST /api/integration-hub", () => {
  it("creates integration and returns 201", async () => {
    svc.create.mockResolvedValueOnce(fakeConfig);
    const res = await request(app)
      .post("/api/integration-hub")
      .set(AUTH)
      .send({ integrationKey: "dialer_3", integrationName: "Dialer 3", integrationType: "rest_pull" });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it("returns 400 for invalid integrationType", async () => {
    const res = await request(app)
      .post("/api/integration-hub")
      .set(AUTH)
      .send({ integrationKey: "x", integrationName: "X", integrationType: "bad_type" });
    expect(res.status).toBe(400);
  });
});

// ─── PUT /api/integration-hub/:key ────────────────────────────────────────────

describe("PUT /api/integration-hub/:key", () => {
  it("updates integration", async () => {
    svc.update.mockResolvedValueOnce({ ...fakeConfig, integration_name: "Updated" });
    const res = await request(app)
      .put("/api/integration-hub/dialer_1")
      .set(AUTH)
      .send({ integrationName: "Updated" });
    expect(res.status).toBe(200);
    expect(res.body.data.integration_name).toBe("Updated");
  });
});

// ─── GET /api/integration-hub/runs ────────────────────────────────────────────

describe("GET /api/integration-hub/runs", () => {
  it("returns paginated runs", async () => {
    svc.listRuns.mockResolvedValueOnce({ data: [], total: 0, page: 1, limit: 20 });
    const res = await request(app).get("/api/integration-hub/runs").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.total).toBe(0);
  });

  it("returns 400 for page < 1", async () => {
    const res = await request(app).get("/api/integration-hub/runs?page=0").set(AUTH);
    expect(res.status).toBe(400);
  });
});

// ─── POST /api/integration-hub/:key/run ───────────────────────────────────────

describe("POST /api/integration-hub/:key/run", () => {
  it("executes the connector and returns a completed run", async () => {
    svc.getByKey.mockResolvedValueOnce(fakeConfig);
    mockExecuteConnector.mockResolvedValueOnce({
      run_id: "run-1",
      rows_fetched: 12,
      rows_promoted: 10,
      rows_failed: 2,
      status: "complete",
    });
    const res = await request(app)
      .post("/api/integration-hub/dialer_1/run")
      .set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("complete");
    expect(res.body.data.rows_fetched).toBe(12);
  });
});

// ─── GET /api/integration-hub/:key/field-maps ─────────────────────────────────

describe("GET /api/integration-hub/:key/field-maps", () => {
  it("returns field maps for the integration", async () => {
    svc.listFieldMaps.mockResolvedValueOnce([
      { id: "m1", integration_key: "dialer_1", source_field: "emp_id", target_table: "employees", target_column: "employee_code" },
    ]);
    const res = await request(app).get("/api/integration-hub/dialer_1/field-maps").set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe("Integration table and header mapping metadata", () => {
  it("returns approved target tables and columns", async () => {
    svc.getMappingCatalog.mockReturnValueOnce([
      { table: "dialer_session_log", columns: ["employee_code"], sync_modes: ["daily_aggregate"] },
    ]);
    const res = await request(app)
      .get("/api/integration-hub/mapping-catalog")
      .set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.data[0].table).toBe("dialer_session_log");
  });

  it("returns detected source table headers", async () => {
    svc.inspectSourceSchema.mockResolvedValueOnce([
      { table: "vicidial_agent_log_249", columns: [{ name: "user", type: "varchar(20)" }] },
    ]);
    const res = await request(app)
      .get("/api/integration-hub/dialer_1/source-schema")
      .set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.data[0].columns[0].name).toBe("user");
  });

  it("saves a source-to-HRMS table mapping", async () => {
    svc.upsertTableMap.mockResolvedValueOnce({
      id: "tm-1",
      integration_key: "dialer_1",
      source_table: "vicidial_agent_log_249",
      target_table: "dialer_session_log",
      sync_mode: "daily_aggregate",
    });
    const res = await request(app)
      .put("/api/integration-hub/dialer_1/table-maps")
      .set(AUTH)
      .send({
        sourceTable: "vicidial_agent_log_249",
        targetTable: "dialer_session_log",
        syncMode: "daily_aggregate",
      });
    expect(res.status).toBe(200);
    expect(res.body.data.source_table).toBe("vicidial_agent_log_249");
  });

  it("accepts the approved COSEC biometric destination", async () => {
    svc.upsertTableMap.mockResolvedValueOnce({
      id: "tm-cosec",
      integration_key: "Cosec",
      source_table: "dbo.AttendanceEvents",
      target_table: "integration_biometric_daily",
      sync_mode: "daily_aggregate",
    });
    const res = await request(app)
      .put("/api/integration-hub/Cosec/table-maps")
      .set(AUTH)
      .send({
        sourceTable: "dbo.AttendanceEvents",
        targetTable: "integration_biometric_daily",
        syncMode: "daily_aggregate",
      });
    expect(res.status).toBe(200);
    expect(res.body.data.target_table).toBe("integration_biometric_daily");
  });
});

// ─── POST /api/integration-hub/field-maps/confirm ─────────────────────────────

describe("POST /api/integration-hub/field-maps/confirm", () => {
  it("confirms field mapping", async () => {
    svc.confirmFieldMap.mockResolvedValueOnce({
      id: "m1", integration_key: "dialer_1", source_field: "emp_id",
      target_table: "employees", target_column: "employee_code",
    });
    const res = await request(app)
      .post("/api/integration-hub/field-maps/confirm")
      .set(AUTH)
      .send({
        integrationKey: "dialer_1",
        sourceField: "emp_id",
        targetTable: "employees",
        targetColumn: "employee_code",
      });
    expect(res.status).toBe(200);
    expect(res.body.data.source_field).toBe("emp_id");
  });

  it("returns 400 when required fields missing", async () => {
    const res = await request(app)
      .post("/api/integration-hub/field-maps/confirm")
      .set(AUTH)
      .send({ integrationKey: "dialer_1" });
    expect(res.status).toBe(400);
  });
});

// ─── GET /api/integration-hub/:key/suggestions ────────────────────────────────

describe("GET /api/integration-hub/:key/suggestions", () => {
  it("returns suggestions for an integration", async () => {
    svc.listSuggestions.mockResolvedValueOnce([
      { id: "s1", integration_key: "dialer_1", source_field: "branch_code", status: "pending" },
    ]);
    const res = await request(app)
      .get("/api/integration-hub/dialer_1/suggestions")
      .set(AUTH);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});
