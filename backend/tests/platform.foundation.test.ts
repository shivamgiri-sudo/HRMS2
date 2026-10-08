/**
 * Package 1 — Platform foundation tests.
 * Covers: org masters API, approval workflow engine, role admin, audit log, access control.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

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
vi.mock("../src/db/mysql.js", () => ({ db: { execute: vi.fn().mockResolvedValue([[], []]) }, pingDb: vi.fn() }));

import { app } from "../src/app.js";
import { db } from "../src/db/mysql.js";
// supabaseAdmin stays mocked above (app.ts imports it), but authMiddleware no
// longer calls it — auth is MySQL JWT now.

const mockExecute = db.execute as ReturnType<typeof vi.fn>;

const JWT_SECRET = process.env.JWT_SECRET || "change-me-jwt-secret-32characters!!";

/**
 * A fresh subject for every authAs() call.
 *
 * authMiddleware caches resolved role context for 30 seconds keyed by user id.
 * This suite reuses one token across different role setups — the workflow-act
 * test arranges a "manager" role but sends ADMIN_TOKEN — so a fixed subject
 * would serve whichever roles were resolved first and silently test the wrong
 * identity. A unique subject per call guarantees a cache miss, so the roles
 * arranged by the test are the roles the request actually carries.
 */
let subjectCounter = 0;
const bearer = (sub: string) => ({
  Authorization: `Bearer ${jwt.sign(
    { sub, email: `${sub}@test.com`, iat: Math.floor(Date.now() / 1000) },
    JWT_SECRET,
    { expiresIn: "1h" },
  )}`,
});

/**
 * Authenticate with the given roles and route db.execute by SQL rather than by
 * call order. Returns the Authorization header to send.
 *
 * The retired "<role>.token" placeholders this file used could not authenticate
 * at all once auth moved to MySQL JWTs — jwt.verify throws on them — so all 18
 * failures here were 401s and none of the org-master, workflow, role-admin or
 * audit rules were ever exercised.
 *
 * `routes` are matched first, in order, so a test can answer a specific query;
 * everything else falls through to roles, empty reads, or affectedRows for
 * writes. Call counts and ordering stop mattering, which is what the auth
 * cache's variable query count otherwise breaks.
 */
function authAs(
  userId: string,
  roles: string[],
  routes: Array<[RegExp, unknown[]]> = [],
  /**
   * Use `userId` verbatim as the JWT subject instead of appending a counter.
   * Only for tests where the caller's identity must equal something the request
   * body names — self-revocation, for instance, is detected by comparing the
   * authenticated id against the target id, so a uniquified subject would never
   * match and the guard would silently never fire.
   */
  exactSubject = false,
) {
  mockExecute.mockImplementation(async (sql: unknown) => {
    const text = String(sql);
    // Auth queries resolve first so a test's routes can be as broad as it likes
    // without accidentally answering the role lookup.
    if (/FROM user_roles/i.test(text)) return [roles.map((r) => ({ role_key: r })), []];
    if (/user_assignment_scope|FROM auth_user/i.test(text)) return [[], []];
    for (const [pattern, rows] of routes) {
      if (pattern.test(text)) return [rows, []];
    }
    if (/^\s*(INSERT|UPDATE|DELETE|REPLACE)/i.test(text)) return [{ affectedRows: 1 }, []];
    return [[], []];
  });
  return bearer(exactSubject ? userId : `${userId}-${++subjectCounter}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExecute.mockReset();
  mockExecute.mockResolvedValue([[], []]);
});

// ── Org Masters ───────────────────────────────────────────────────────────────

describe("GET /api/org/branches — list branches", () => {
  it("returns 200 with branch list for authenticated user", async () => {
    const auth = authAs("u-1", ["admin"], [[/branch/i, [{ id: "b-1", branch_name: "Mumbai", active_status: 1 }]]]);
    const r = await request(app).get("/api/org/branches").set(auth);
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
    const auth = authAs("u-emp", ["employee"]);
    const r = await request(app).post("/api/org/branches").set(auth)
      .send({ branch_code: "MUM", branch_name: "Mumbai" });
    expect(r.status).toBe(403);
  });

  it("creates branch for admin", async () => {
    const auth = authAs("u-admin", ["admin"], [[/branch/i, [{ id: "b-new", branch_code: "MUM", branch_name: "Mumbai" }]]]);
    const r = await request(app).post("/api/org/branches").set(auth)
      .send({ branch_code: "MUM", branch_name: "Mumbai" });
    expect(r.status).toBe(201);
  });
});

describe("GET /api/org/grade-bands — grade band list", () => {
  it("returns 200 for authenticated user", async () => {
    const auth = authAs("u-1", ["admin"], [[/grade/i, [{ id: "g-1", grade_code: "A", grade_name: "Grade A" }]]]);
    const r = await request(app).get("/api/org/grade-bands").set(auth);
    expect(r.status).toBe(200);
  });
});

// ── Workflow Engine ───────────────────────────────────────────────────────────

describe("GET /api/workflow — list workflows", () => {
  it("returns 200 for admin", async () => {
    const auth = authAs("u-admin", ["admin"], [[/workflow/i, [{ id: "w-1", workflow_code: "LEAVE_APPROVAL" }]]]);
    const r = await request(app).get("/api/workflow").set(auth);
    expect(r.status).toBe(200);
  });

  it("returns 403 for employee", async () => {
    const auth = authAs("u-emp", ["employee"]);
    const r = await request(app).get("/api/workflow").set(auth);
    expect(r.status).toBe(403);
  });
});

describe("POST /api/workflow/requests — create approval request", () => {
  it("returns 400 when required fields missing", async () => {
    const auth = authAs("u-1", ["admin"]);
    const r = await request(app).post("/api/workflow/requests").set(auth)
      .send({ workflow_code: "LEAVE_APPROVAL" }); // missing entity fields
    expect(r.status).toBe(400);
  });

  it("creates request for authenticated user", async () => {
    const auth = authAs("u-1", ["admin"], [
      [/approval_request|workflow_request/i, [{
        id: "r-1", workflow_id: "w-1", module_key: "LEAVE",
        entity_type: "leave_request", entity_id: "lr-1",
        current_step: 1, status: "pending", requested_by: "u-1",
      }]],
      [/workflow/i, [{ id: "w-1", workflow_code: "LEAVE_APPROVAL" }]],
    ]);
    const r = await request(app).post("/api/workflow/requests").set(auth)
      .send({ workflow_code: "LEAVE_APPROVAL", module_key: "LEAVE", entity_type: "leave_request", entity_id: "lr-1" });
    expect(r.status).toBe(201);
    expect(r.body.data.status).toBe("pending");
  });
});

describe("POST /api/workflow/requests/:id/act", () => {
  it("returns 400 for invalid action", async () => {
    const auth = authAs("u-manager", ["manager"]);
    const r = await request(app).post("/api/workflow/requests/r-1/act").set(auth)
      .send({ action: "invalidAction" });
    expect(r.status).toBe(400);
  });

  it("approves request and advances step", async () => {
    const auth = authAs("u-tl", ["tl"], [
      [/COUNT|total/i, [{ total: 1 }]],
      [/approval_request|workflow_request|FROM request/i, [{
        id: "r-1", workflow_id: "w-1", current_step: 1, status: "pending", requested_by: "u-requester",
      }]],
    ]);
    const r = await request(app).post("/api/workflow/requests/r-1/act").set(auth)
      .send({ action: "approved", remarks: "Looks good" });
    expect(r.status).toBe(200);
  });
});

// ── Role Administration ───────────────────────────────────────────────────────

describe("POST /api/access/roles/assign", () => {
  it("returns 403 for non-admin", async () => {
    const auth = authAs("u-hr", ["hr"]);
    const r = await request(app).post("/api/access/roles/assign").set(auth)
      .send({ user_id: "u-target", role_key: "tl" });
    expect(r.status).toBe(403);
  });

  it("returns 400 when fields missing", async () => {
    const auth = authAs("u-admin", ["admin"]);
    const r = await request(app).post("/api/access/roles/assign").set(auth)
      .send({ user_id: "u-target" }); // missing role_key
    expect(r.status).toBe(400);
  });

  it("assigns role and writes audit log for admin", async () => {
    const auth = authAs("u-admin", ["admin"], [
      [/role_catalog|role_master/i, [{ role_key: "tl" }]],
      [/FROM auth_user|FROM users|active_status/i, [{ id: "u-target" }]],
    ]);
    const r = await request(app).post("/api/access/roles/assign").set(auth)
      .send({ user_id: "u-target", role_key: "tl" });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    // Verify audit INSERT was called
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const auditCall = mockExecute.mock.calls.find(([sql]: any) =>
      typeof sql === "string" && sql.includes("sensitive_action_log")
    );
    expect(auditCall).toBeDefined();
  });

  it("prevents a normal admin from assigning super_admin", async () => {
    const auth = authAs("u-admin", ["admin"]);
    const r = await request(app).post("/api/access/roles/assign").set(auth)
      .send({ user_id: "u-target", role_key: "super_admin" });
    expect(r.status).toBe(403);
  });
});

describe("POST /api/access/roles/revoke", () => {
  it("revokes role and writes audit log for admin", async () => {
    const auth = authAs("u-admin", ["admin"]);
    const r = await request(app).post("/api/access/roles/revoke").set(auth)
      .send({ user_id: "u-target", role_key: "tl" });
    expect(r.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const auditCall = mockExecute.mock.calls.find(([sql]: any) =>
      typeof sql === "string" && sql.includes("sensitive_action_log")
    );
    expect(auditCall).toBeDefined();
  });

  it("prevents an administrator from revoking their own role", async () => {
    // The guard compares the authenticated id with the target id, so the caller
    // must actually BE user-1 for self-revocation to be what is under test.
    const auth = authAs("user-1", ["admin"], [], true);
    const r = await request(app).post("/api/access/roles/revoke").set(auth)
      .send({ user_id: "user-1", role_key: "admin" });
    expect(r.status).toBe(400);
  });
});

// ── Audit Log ─────────────────────────────────────────────────────────────────

describe("GET /api/access/audit-log", () => {
  /**
   * This used to assert 403 for hr. That expectation predates the role-filtered
   * design: getAuditLogExtended admits admin, payroll_head and hr/wfm, and
   * narrows the rows each may see by module ("employee: cannot access" per its
   * own docblock). Asserting 403 for hr therefore tested a rule the system no
   * longer has — while nothing tested the rule it does have. Split into the two
   * assertions that describe the real boundary.
   */
  it("returns 403 for a role with no audit entitlement", async () => {
    const auth = authAs("u-emp", ["employee"]);
    const r = await request(app).get("/api/access/audit-log").set(auth);
    expect(r.status).toBe(403);
  });

  it("admits hr but restricts it to its own modules rather than the whole log", async () => {
    const auth = authAs("u-hr", ["hr"]);
    const r = await request(app).get("/api/access/audit-log").set(auth);
    expect(r.status).toBe(200);
    // The narrowing must happen in SQL — a 200 alone would not prove hr is
    // prevented from reading payroll or access-control audit entries.
    const restricted = mockExecute.mock.calls.some(
      ([sql]: [unknown]) =>
        typeof sql === "string" &&
        /module_key IN \('attendance','regularization','dispute','wfm'\)/.test(sql),
    );
    expect(restricted).toBe(true);
  });

  it("returns audit entries for admin", async () => {
    const auth = authAs("u-admin", ["admin"], [[/audit/i, [
      { id: "a-1", actor_user_id: "u-admin", action_type: "ROLE_ASSIGNED", module_key: "ACCESS_CONTROL" },
    ]]]);
    const r = await request(app).get("/api/access/audit-log").set(auth);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.data)).toBe(true);
  });
});
