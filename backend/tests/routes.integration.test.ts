import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// Mock all external I/O before importing app
vi.mock("../src/db/supabaseAdmin.js", () => ({
  supabaseAdmin: {},
  supabaseAuthClient: {
    auth: {
      getUser: vi.fn(),
    },
  },
}));

vi.mock("../src/db/mysql.js", () => ({
  db: { execute: vi.fn().mockResolvedValue([[], []]) },
  pingDb: vi.fn(),
}));

vi.mock("../src/modules/process/process.repository.js", () => ({
  getProcessRepository: vi.fn(),
}));

// /api/health reports healthy only when the database pings AND the schema
// verifies, so both inputs have to be controlled here. Without this the real
// verifySchemaVersion runs against a mocked database, finds migrations pending
// and returns 503 regardless of what pingDb was told to do.
// health.routes.ts imports THREE things from this module. The mock supplied two, so the
// third threw "No export is defined on the mock" inside the handler — which meant the route
// never responded and supertest sat there until the test timed out. Both /health tests
// failed that way, reported only as a timeout, which reads like a slow database rather than
// a missing mock export.
//
// getSchemaVerificationState is SYNCHRONOUS (it reads an in-memory cache — see the comment
// in health.routes.ts about zero DB cost), so it must not be mocked as a promise. `valid:
// true` also keeps the handler off its self-heal branch, which would otherwise fire a live
// schema check from a unit test.
vi.mock("../src/db/runPendingMigrations.js", () => ({
  verifySchemaVersion: vi.fn().mockResolvedValue({ valid: true, pendingCount: 0 }),
  getMigrationHealth: vi.fn().mockResolvedValue({ applied: 0, pending: 0, failed: 0 }),
  getSchemaVerificationState: vi.fn(() => ({
    state: "verified" as const,
    appliedCount: 0,
    pendingCount: 0,
    pendingFiles: [] as string[],
    lastCheckedAt: "2026-01-01T00:00:00.000Z",
    valid: true,
  })),
}));

import { supabaseAuthClient } from "../src/db/supabaseAdmin.js";
import { db, pingDb } from "../src/db/mysql.js";
import { getProcessRepository } from "../src/modules/process/process.repository.js";
import { app } from "../src/app.js";

const mockGetUser = supabaseAuthClient.auth.getUser as ReturnType<typeof vi.fn>;
const mockPingDb = pingDb as ReturnType<typeof vi.fn>;
const mockDbExecute = db.execute as ReturnType<typeof vi.fn>;
const mockGetRepo = getProcessRepository as ReturnType<typeof vi.fn>;

const mockRepo = {
  list: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  updateStatus: vi.fn(),
};

const fakeProcess = {
  id: "proc-1",
  process_code: "IB",
  process_name: "Inbound",
  department_id: null,
  process_type: null,
  branch_name: null,
  location_name: null,
  process_owner_employee_id: null,
  process_manager_employee_id: null,
  active_status: true,
  description: null,
  metadata: {},
  created_by: "user-1",
  updated_by: "user-1",
  created_at: "2026-05-01T00:00:00Z",
  updated_at: "2026-05-01T00:00:00Z",
};

function authHeader() {
  return { Authorization: "Bearer mock-token-admin" };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDbExecute.mockReset().mockResolvedValue([[{ role_key: "admin" }], []]);
  mockGetRepo.mockReturnValue(mockRepo);
});

// ─── Health Route ──────────────────────────────────────────────────────────────

describe("GET /api/health", () => {
  it("returns healthy status when the database pings and the schema verifies", async () => {
    mockPingDb.mockResolvedValueOnce(undefined);
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe("healthy");
    expect(res.body.timestamp).toBeDefined();
  });

  it("reports degraded without disclosing why when the database is unreachable", async () => {
    mockPingDb.mockRejectedValueOnce(new Error("connection refused"));

    const res = await request(app).get("/api/health");

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.status).toBe("degraded");
    // The endpoint is unauthenticated, and deliberately stopped returning a `db`
    // field or any migration detail — an anonymous caller learning which
    // component failed is reconnaissance. This asserted res.body.db === "error"
    // and so could not pass once that detail was withheld on purpose.
    expect(res.body.db).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/migration|schema|pending/i);
  });
});

// ─── Root Route ────────────────────────────────────────────────────────────────

describe("GET /", () => {
  it("returns service info", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.body.service).toBe("MCN HRMS Backend API");
  });
});

// ─── 404 Handler ───────────────────────────────────────────────────────────────

describe("Unknown route", () => {
  // /api/nonexistent is intercepted by clientRouter (mounted at /api with requireAuth),
  // so an unauthenticated request returns 401, not 404.
  it("returns 401 for unauthenticated request to unregistered /api route", async () => {
    const res = await request(app).get("/api/nonexistent");
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

// ─── Process Routes — Auth Guard ───────────────────────────────────────────────

describe("GET /api/processes — auth guard", () => {
  it("returns 401 when no token provided", async () => {
    const res = await request(app).get("/api/processes");
    expect(res.status).toBe(401);
  });

  it("returns 401 when token is invalid", async () => {
    const res = await request(app).get("/api/processes").set({ Authorization: "Bearer bad-invalid-jwt-here" });
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/processes ────────────────────────────────────────────────────────

describe("GET /api/processes", () => {
  beforeEach(() => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-1", email: "admin@mcn.com" } },
      error: null,
    });
  });

  it("returns list of processes", async () => {
    mockRepo.list.mockResolvedValueOnce([fakeProcess]);
    const res = await request(app).get("/api/processes").set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].process_code).toBe("IB");
  });

  it("filters by activeStatus query param", async () => {
    mockRepo.list.mockResolvedValueOnce([]);
    await request(app).get("/api/processes?activeStatus=active").set(authHeader());
    expect(mockRepo.list).toHaveBeenCalledWith(
      expect.objectContaining({ activeStatus: "active" })
    );
  });

  it("returns 400 for invalid activeStatus value", async () => {
    const res = await request(app).get("/api/processes?activeStatus=bad").set(authHeader());
    expect(res.status).toBe(400);
  });
});

// ─── GET /api/processes/:id ────────────────────────────────────────────────────

describe("GET /api/processes/:id", () => {
  beforeEach(() => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-1", email: "admin@mcn.com" } },
      error: null,
    });
  });

  it("returns process by id", async () => {
    mockRepo.getById.mockResolvedValueOnce(fakeProcess);
    const res = await request(app).get("/api/processes/proc-1").set(authHeader());
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe("proc-1");
  });

  it("returns 500 when process not found", async () => {
    mockRepo.getById.mockResolvedValueOnce(null);
    const res = await request(app).get("/api/processes/missing").set(authHeader());
    expect(res.status).toBe(500);
    expect(res.body.message).toMatch(/Process not found/i);
  });
});

// ─── POST /api/processes ───────────────────────────────────────────────────────

describe("POST /api/processes", () => {
  beforeEach(() => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-1", email: "admin@mcn.com" } },
      error: null,
    });
  });

  it("creates process and returns 201", async () => {
    mockRepo.list.mockResolvedValueOnce([]);
    mockRepo.create.mockResolvedValueOnce(fakeProcess);

    const res = await request(app)
      .post("/api/processes")
      .set(authHeader())
      .send({ processCode: "IB", processName: "Inbound" });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/created/i);
  });

  it("returns 400 when processCode is missing", async () => {
    const res = await request(app)
      .post("/api/processes")
      .set(authHeader())
      .send({ processName: "Inbound" });
    expect(res.status).toBe(400);
  });

  it("returns 500 when process code already exists", async () => {
    mockRepo.list.mockResolvedValueOnce([fakeProcess]); // duplicate
    const res = await request(app)
      .post("/api/processes")
      .set(authHeader())
      .send({ processCode: "IB", processName: "Inbound Duplicate" });
    expect(res.status).toBe(500);
    expect(res.body.message).toMatch(/already exists/i);
  });
});

// ─── PUT /api/processes/:id ────────────────────────────────────────────────────

describe("PUT /api/processes/:id", () => {
  beforeEach(() => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-1", email: "admin@mcn.com" } },
      error: null,
    });
  });

  it("updates and returns process", async () => {
    mockRepo.getById.mockResolvedValueOnce(fakeProcess);
    const updated = { ...fakeProcess, process_name: "Updated" };
    mockRepo.update.mockResolvedValueOnce(updated);

    const res = await request(app)
      .put("/api/processes/proc-1")
      .set(authHeader())
      .send({ processName: "Updated" });

    expect(res.status).toBe(200);
    expect(res.body.data.process_name).toBe("Updated");
  });
});

// ─── PATCH /api/processes/:id/status ──────────────────────────────────────────

describe("PATCH /api/processes/:id/status", () => {
  beforeEach(() => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-1", email: "admin@mcn.com" } },
      error: null,
    });
  });

  it("deactivates process", async () => {
    mockRepo.getById.mockResolvedValueOnce(fakeProcess);
    mockRepo.updateStatus.mockResolvedValueOnce({ ...fakeProcess, active_status: false });

    const res = await request(app)
      .patch("/api/processes/proc-1/status")
      .set(authHeader())
      .send({ activeStatus: false });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/deactivated/i);
  });

  it("returns 400 when activeStatus is missing", async () => {
    const res = await request(app)
      .patch("/api/processes/proc-1/status")
      .set(authHeader())
      .send({});
    expect(res.status).toBe(400);
  });
});
