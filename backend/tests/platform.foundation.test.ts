/**
 * Package 1 — Platform foundation tests.
 * Covers: org masters API, approval workflow engine, role admin, audit log, access control.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../src/db/supabaseAdmin.js", () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        order: vi.fn(() => Promise.resolve({ data: [], error: null })),
      })),
    })),
  },
  supabaseAuthClient: { auth: { getUser: vi.fn() } },
}));
vi.mock("../src/db/mysql.js", () => ({ db: { execute: vi.fn() }, pingDb: vi.fn() }));

import { app } from "../src/app.js";
import { db } from "../src/db/mysql.js";
import { supabaseAuthClient } from "../src/db/supabaseAdmin.js";

const mockExecute = db.execute as ReturnType<typeof vi.fn>;
const mockGetUser = supabaseAuthClient.auth.getUser as ReturnType<typeof vi.fn>;

function authAs(userId: string, roles: string[]) {
  mockGetUser.mockResolvedValue({ data: { user: { id: userId, email: `${userId}@test.com` } }, error: null });
  // First execute call for requireRole, subsequent for service queries
  mockExecute.mockResolvedValueOnce([roles.map((r) => ({ role_key: r })), []]);
}

const ADMIN_TOKEN = { Authorization: "Bearer admin.token" };
const HR_TOKEN = { Authorization: "Bearer hr.token" };
const EMP_TOKEN = { Authorization: "Bearer emp.token" };

beforeEach(() => vi.clearAllMocks());

// ── Org Masters ───────────────────────────────────────────────────────────────

describe("GET /api/org/branches — list branches", () => {
  it("returns 200 with branch list for authenticated user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-1", email: "u@test.com" } }, error: null });
    mockExecute.mockResolvedValueOnce([[{ id: "b-1", branch_name: "Mumbai", active_status: 1 }], []]);
    const r = await request(app).get("/api/org/branches").set(ADMIN_TOKEN);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.data)).toBe(true);
  });

  it("returns 401 without token", async () => {
    const r = await request(app).get("/api/org/branches");
    expect(r.status).toBe(401);
  });
});

describe("POST /api/org/branches — create branch", () => {
  it("returns 403 for employee role", async () => {
    authAs("u-emp", ["employee"]);
    const r = await request(app).post("/api/org/branches").set(EMP_TOKEN)
      .send({ branch_code: "MUM", branch_name: "Mumbai" });
    expect(r.status).toBe(403);
  });

  it("creates branch for admin", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-admin", email: "admin@test.com" } }, error: null });
    mockExecute.mockResolvedValueOnce([[{ role_key: "admin" }], []]);
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    mockExecute.mockResolvedValueOnce([[{ id: "b-new", branch_code: "MUM", branch_name: "Mumbai" }], []]);
    const r = await request(app).post("/api/org/branches").set(ADMIN_TOKEN)
      .send({ branch_code: "MUM", branch_name: "Mumbai" });
    expect(r.status).toBe(201);
  });
});

describe("GET /api/org/grade-bands — grade band list", () => {
  it("returns 200 for authenticated user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-1", email: "u@test.com" } }, error: null });
    mockExecute.mockResolvedValueOnce([[{ id: "g-1", grade_code: "A", grade_name: "Grade A" }], []]);
    const r = await request(app).get("/api/org/grade-bands").set(ADMIN_TOKEN);
    expect(r.status).toBe(200);
  });
});

// ── Workflow Engine ───────────────────────────────────────────────────────────

describe("GET /api/workflow — list workflows", () => {
  it("returns 200 for admin", async () => {
    authAs("u-admin", ["admin"]);
    mockExecute.mockResolvedValueOnce([[{ id: "w-1", workflow_code: "LEAVE_APPROVAL" }], []]);
    const r = await request(app).get("/api/workflow").set(ADMIN_TOKEN);
    expect(r.status).toBe(200);
  });

  it("returns 403 for employee", async () => {
    authAs("u-emp", ["employee"]);
    const r = await request(app).get("/api/workflow").set(EMP_TOKEN);
    expect(r.status).toBe(403);
  });
});

describe("POST /api/workflow/requests — create approval request", () => {
  it("returns 400 when required fields missing", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-1", email: "u@test.com" } }, error: null });
    const r = await request(app).post("/api/workflow/requests").set(ADMIN_TOKEN)
      .send({ workflow_code: "LEAVE_APPROVAL" }); // missing entity fields
    expect(r.status).toBe(400);
  });

  it("creates request for authenticated user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-1", email: "u@test.com" } }, error: null });
    // workflow lookup
    mockExecute.mockResolvedValueOnce([[{ id: "w-1", workflow_code: "LEAVE_APPROVAL" }], []]);
    // insert
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    // fetch created
    mockExecute.mockResolvedValueOnce([[{
      id: "r-1", workflow_id: "w-1", module_key: "LEAVE",
      entity_type: "leave_request", entity_id: "lr-1",
      current_step: 1, status: "pending", requested_by: "u-1",
    }], []]);
    const r = await request(app).post("/api/workflow/requests").set(ADMIN_TOKEN)
      .send({ workflow_code: "LEAVE_APPROVAL", module_key: "LEAVE", entity_type: "leave_request", entity_id: "lr-1" });
    expect(r.status).toBe(201);
    expect(r.body.data.status).toBe("pending");
  });
});

describe("POST /api/workflow/requests/:id/act", () => {
  it("returns 400 for invalid action", async () => {
    authAs("u-manager", ["manager"]);
    const r = await request(app).post("/api/workflow/requests/r-1/act").set(ADMIN_TOKEN)
      .send({ action: "invalidAction" });
    expect(r.status).toBe(400);
  });

  it("approves request and advances step", async () => {
    authAs("u-tl", ["tl"]);
    // fetch request
    mockExecute.mockResolvedValueOnce([[{
      id: "r-1", workflow_id: "w-1", current_step: 1, status: "pending", requested_by: "u-requester",
    }], []]);
    // insert action log
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    // check more steps
    mockExecute.mockResolvedValueOnce([[{ total: 1 }], []]);
    // advance step
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);
    // fetch updated
    mockExecute.mockResolvedValueOnce([[{
      id: "r-1", current_step: 2, status: "pending",
    }], []]);
    const r = await request(app).post("/api/workflow/requests/r-1/act").set(ADMIN_TOKEN)
      .send({ action: "approved", remarks: "Looks good" });
    expect(r.status).toBe(200);
  });
});

// ── Role Administration ───────────────────────────────────────────────────────

describe("POST /api/access/roles/assign", () => {
  it("returns 403 for non-admin", async () => {
    authAs("u-hr", ["hr"]);
    const r = await request(app).post("/api/access/roles/assign").set(HR_TOKEN)
      .send({ user_id: "u-target", role_key: "tl" });
    expect(r.status).toBe(403);
  });

  it("returns 400 when fields missing", async () => {
    authAs("u-admin", ["admin"]);
    const r = await request(app).post("/api/access/roles/assign").set(ADMIN_TOKEN)
      .send({ user_id: "u-target" }); // missing role_key
    expect(r.status).toBe(400);
  });

  it("assigns role and writes audit log for admin", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-admin", email: "admin@test.com" } }, error: null });
    mockExecute.mockResolvedValueOnce([[{ role_key: "admin" }], []]);  // requireRole
    mockExecute.mockResolvedValueOnce([[{ role_key: "tl" }], []]);     // catalog check
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);      // insert user_roles
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);      // audit log insert
    const r = await request(app).post("/api/access/roles/assign").set(ADMIN_TOKEN)
      .send({ user_id: "u-target", role_key: "tl" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    // Verify audit INSERT was called
    const auditCall = mockExecute.mock.calls.find(([sql]: [string]) =>
      typeof sql === "string" && sql.includes("sensitive_action_log")
    );
    expect(auditCall).toBeDefined();
  });
});

describe("POST /api/access/roles/revoke", () => {
  it("revokes role and writes audit log for admin", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-admin", email: "admin@test.com" } }, error: null });
    mockExecute.mockResolvedValueOnce([[{ role_key: "admin" }], []]);
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);  // update user_roles
    mockExecute.mockResolvedValueOnce([{ affectedRows: 1 }, []]);  // audit log
    const r = await request(app).post("/api/access/roles/revoke").set(ADMIN_TOKEN)
      .send({ user_id: "u-target", role_key: "tl" });
    expect(r.status).toBe(200);
    const auditCall = mockExecute.mock.calls.find(([sql]: [string]) =>
      typeof sql === "string" && sql.includes("sensitive_action_log")
    );
    expect(auditCall).toBeDefined();
  });
});

// ── Audit Log ─────────────────────────────────────────────────────────────────

describe("GET /api/access/audit-log", () => {
  it("returns 403 for non-admin", async () => {
    authAs("u-hr", ["hr"]);
    const r = await request(app).get("/api/access/audit-log").set(HR_TOKEN);
    expect(r.status).toBe(403);
  });

  it("returns audit entries for admin", async () => {
    authAs("u-admin", ["admin"]);
    mockExecute.mockResolvedValueOnce([[
      { id: "a-1", actor_user_id: "u-admin", action_type: "ROLE_ASSIGNED", module_key: "ACCESS_CONTROL" }
    ], []]);
    const r = await request(app).get("/api/access/audit-log").set(ADMIN_TOKEN);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.data)).toBe(true);
  });
});
