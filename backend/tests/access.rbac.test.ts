/**
 * Package 0-B RBAC reconciliation tests.
 *
 * Verifies:
 * 1. Non-admin users get 403 on the reconciliation endpoint
 * 2. Admin users can retrieve the report
 * 3. A user with a Supabase role but no MySQL role is denied by requireRole
 *    (backend API authority lives in MySQL only)
 *
 * AUTH MOCKING
 * ------------
 * Authentication is MySQL JWT — authService.verifyAccessToken — not Supabase.
 * This suite used to authenticate by mocking supabaseAuthClient.auth.getUser,
 * which the request path no longer consults, so every request 401'd and none of
 * the assertions below were reached.
 *
 * supabaseAdmin is still mocked, because the reconciliation SERVICE genuinely
 * reads Supabase roles to compare them against MySQL. That is the subject of the
 * test, not the way in.
 *
 * Role lookups are matched on SQL rather than by call order. requireAuth resolves
 * a user's roles and read-only flag on a cache miss, so the number of queries
 * before the handler runs depends on cache state — positional mockResolvedValueOnce
 * chains silently shift when that changes. Matching on the statement is stable
 * whatever the middleware does.
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

vi.mock("../src/modules/auth/auth.service.js", () => ({
  authService: { verifyAccessToken: vi.fn() },
}));

vi.mock("../src/db/mysql.js", () => ({
  db: { execute: vi.fn().mockResolvedValue([[], []]) },
  pingDb: vi.fn(),
}));

import { app } from "../src/app.js";
import { db } from "../src/db/mysql.js";
import { supabaseAdmin } from "../src/db/supabaseAdmin.js";
import { authService } from "../src/modules/auth/auth.service.js";
import { invalidateAuthContextCache } from "../src/middleware/authMiddleware.js";

const mockExecute = db.execute as ReturnType<typeof vi.fn>;
const mockVerify = authService.verifyAccessToken as ReturnType<typeof vi.fn>;
const mockFrom = supabaseAdmin.from as ReturnType<typeof vi.fn>;

/** Users this suite authenticates as, so their cached auth context can be cleared. */
const USERS = ["user-employee", "user-hr", "user-admin", "user-supabase-only"];

/**
 * Authenticate as `userId` holding `roleKeys` in MySQL.
 *
 * Every role query answers from `roleKeys`, so it does not matter how many times
 * requireAuth and requireRole each ask. Callers layer service-specific responses
 * on top via `extra`.
 */
function authenticateAs(
  userId: string,
  roleKeys: string[],
  extra?: (sql: string) => unknown[] | undefined,
) {
  mockVerify.mockReturnValue({ id: userId, email: `${userId}@test.com` });
  mockExecute.mockImplementation(async (sql: unknown) => {
    const text = String(sql);
    const fromExtra = extra?.(text);
    if (fromExtra) return fromExtra;
    if (/is_read_only/i.test(text)) return [[{ is_read_only: 0 }], []];
    if (/user_roles/i.test(text)) return [roleKeys.map((role_key) => ({ role_key })), []];
    return [[], []];
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // requireAuth caches a user's resolved roles for 30 seconds. Without this, the
  // second test to authenticate as a given user reuses the first test's roles.
  for (const id of USERS) invalidateAuthContextCache(id);
});

// ── 1. Non-admin blocked ──────────────────────────────────────────────────────

describe("GET /api/access/rbac-reconciliation — access control", () => {
  it("returns 401 with no token", async () => {
    const r = await request(app).get("/api/access/rbac-reconciliation");
    expect(r.status).toBe(401);
  });

  it("returns 403 when authenticated user has employee role only (MySQL)", async () => {
    authenticateAs("user-employee", ["employee"]);

    const r = await request(app)
      .get("/api/access/rbac-reconciliation")
      .set("Authorization", "Bearer valid.staff.token");
    expect(r.status).toBe(403);
  });

  it("returns 403 when user has hr role only (not admin)", async () => {
    authenticateAs("user-hr", ["hr"]);

    const r = await request(app)
      .get("/api/access/rbac-reconciliation")
      .set("Authorization", "Bearer valid.staff.token");
    expect(r.status).toBe(403);
  });
});

// ── 2. Admin can retrieve the report ─────────────────────────────────────────

describe("GET /api/access/rbac-reconciliation — admin access", () => {
  it("returns 200 with reconciliation report for admin user", async () => {
    authenticateAs("user-admin", ["admin"], (sql) =>
      // The service's own scan of MySQL role assignments, as opposed to the
      // caller's role check.
      /SELECT[\s\S]*user_id[\s\S]*role_key/i.test(sql)
        ? [[{ user_id: "u-1", role_key: "admin" }], []]
        : undefined,
    );
    mockFrom.mockReturnValue({
      select: vi.fn(() => ({
        order: vi.fn(() => Promise.resolve({ data: [{ user_id: "u-1", role: "admin" }], error: null })),
      })),
    });

    const r = await request(app)
      .get("/api/access/rbac-reconciliation")
      .set("Authorization", "Bearer valid.staff.token");

    expect(r.status).toBe(200);
    expect(r.body.data).toBeDefined();
    expect(r.body.data).toHaveProperty("mismatches");
    expect(r.body.data).toHaveProperty("total_mysql_users");
    expect(r.body.data).toHaveProperty("total_supabase_users");
    expect(r.body.data).toHaveProperty("checked_at");
  });

  it("reports active MySQL roles pointing to a missing auth_user without querying Supabase", async () => {
    authenticateAs("user-admin", ["admin"], (sql) =>
      /SELECT[\s\S]*user_id[\s\S]*role_key/i.test(sql)
        ? [[{ user_id: "u-missing", role_key: "hr" }], []]
        : undefined,
    );

    const r = await request(app)
      .get("/api/access/rbac-reconciliation")
      .set("Authorization", "Bearer valid.staff.token");

    expect(r.status).toBe(200);
    const report = r.body.data;
    expect(report.mismatches.length).toBeGreaterThan(0);
    const mismatch = report.mismatches.find((m: { user_id: string }) => m.user_id === "u-missing");
    expect(mismatch).toBeDefined();
    expect(mismatch.in_mysql_only).toContain("hr");
    expect(mismatch.supabase_roles).toHaveLength(0);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

// ── 3. Supabase-only role does NOT grant MySQL API access ────────────────────

describe("RBAC authority — MySQL is the backend authority", () => {
  it("user with Supabase role but absent from MySQL user_roles is denied protected API", async () => {
    // The JWT verifies, but MySQL holds no roles for this user.
    authenticateAs("user-supabase-only", []);

    const r = await request(app)
      .get("/api/access/rbac-reconciliation")
      .set("Authorization", "Bearer valid.staff.token");

    expect(r.status).toBe(403);
  });

  it("report does not auto-fix or backfill roles — mismatches are reported only", async () => {
    authenticateAs("user-admin", ["admin"]);
    mockFrom.mockReturnValue({
      select: vi.fn(() => ({
        order: vi.fn(() => Promise.resolve({ data: [{ user_id: "u-ghost", role: "admin" }], error: null })),
      })),
    });

    const r = await request(app)
      .get("/api/access/rbac-reconciliation")
      .set("Authorization", "Bearer valid.staff.token");

    expect(r.status).toBe(200);
    // Reconciliation reports; it must never write. A report that silently
    // repaired the mismatch would hide the drift it exists to surface.
    const writeCalls = mockExecute.mock.calls.filter(([sql]: [unknown]) =>
      typeof sql === "string" && /INSERT|UPDATE|DELETE/i.test(sql),
    );
    expect(writeCalls).toHaveLength(0);
  });
});
