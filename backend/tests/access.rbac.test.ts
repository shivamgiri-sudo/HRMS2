/**
 * Package 0-B RBAC reconciliation tests.
 *
 * Verifies:
 * 1. Non-admin users get 403 on the reconciliation endpoint
 * 2. Admin users can retrieve the report
 * 3. A user with Supabase role but no MySQL role is denied by requireRole middleware
 *    (backend API authority lives in MySQL only)
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

import { app } from "../src/app.js";
import { db } from "../src/db/mysql.js";
import { supabaseAdmin } from "../src/db/supabaseAdmin.js";
import { supabaseAuthClient } from "../src/db/supabaseAdmin.js";

const mockExecute = db.execute as ReturnType<typeof vi.fn>;
const mockGetUser = supabaseAuthClient.auth.getUser as ReturnType<typeof vi.fn>;
const mockFrom = supabaseAdmin.from as ReturnType<typeof vi.fn>;

function mockStaffAuth(userId: string) {
  mockGetUser.mockResolvedValue({ data: { user: { id: userId, email: `${userId}@test.com` } }, error: null });
}

beforeEach(() => vi.clearAllMocks());

// ── 1. Non-admin blocked ──────────────────────────────────────────────────────

describe("GET /api/access/rbac-reconciliation — access control", () => {
  it("returns 401 with no token", async () => {
    const r = await request(app).get("/api/access/rbac-reconciliation");
    expect(r.status).toBe(401);
  });

  it("returns 403 when authenticated user has employee role only (MySQL)", async () => {
    mockStaffAuth("user-employee");
    // MySQL user_roles — only employee
    mockExecute.mockResolvedValueOnce([[{ role_key: "employee" }], []]);

    const r = await request(app)
      .get("/api/access/rbac-reconciliation")
      .set("Authorization", "Bearer valid.staff.token");
    expect(r.status).toBe(403);
  });

  it("returns 403 when user has hr role only (not admin)", async () => {
    mockStaffAuth("user-hr");
    mockExecute.mockResolvedValueOnce([[{ role_key: "hr" }], []]);

    const r = await request(app)
      .get("/api/access/rbac-reconciliation")
      .set("Authorization", "Bearer valid.staff.token");
    expect(r.status).toBe(403);
  });
});

// ── 2. Admin can retrieve the report ─────────────────────────────────────────

describe("GET /api/access/rbac-reconciliation — admin access", () => {
  it("returns 200 with reconciliation report for admin user", async () => {
    mockStaffAuth("user-admin");
    // requireRole check — admin
    mockExecute.mockResolvedValueOnce([[{ role_key: "admin" }], []]);
    // access.service: MySQL user_roles query
    mockExecute.mockResolvedValueOnce([[{ user_id: "u-1", role_key: "admin" }], []]);
    // Supabase user_roles query (via supabaseAdmin.from mock)
    mockFrom.mockReturnValueOnce({
      select: vi.fn(() => ({
        order: vi.fn(() =>
          Promise.resolve({
            data: [{ user_id: "u-1", role: "admin" }],
            error: null,
          })
        ),
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
    mockStaffAuth("user-admin");
    mockExecute.mockResolvedValueOnce([[{ role_key: "admin" }], []]);
    mockExecute.mockResolvedValueOnce([[{ user_id: "u-missing", role_key: "hr" }], []]);
    mockExecute.mockResolvedValueOnce([[{ role_key: "hr" }], []]);
    mockExecute.mockResolvedValueOnce([[], []]);

    const r = await request(app)
      .get("/api/access/rbac-reconciliation")
      .set("Authorization", "Bearer valid.staff.token");

    expect(r.status).toBe(200);
    const report = r.body.data;
    expect(report.mismatches.length).toBeGreaterThan(0);
    const mismatch = report.mismatches.find((m: any) => m.user_id === "u-missing");
    expect(mismatch).toBeDefined();
    expect(mismatch.in_mysql_only).toContain("hr");
    expect(mismatch.supabase_roles).toHaveLength(0);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

// ── 3. Supabase-only role does NOT grant MySQL API access ────────────────────

describe("RBAC authority — MySQL is the backend authority", () => {
  it("user with Supabase role but absent from MySQL user_roles is denied protected API", async () => {
    // Auth passes (Supabase JWT valid)
    mockStaffAuth("user-supabase-only");
    // MySQL user_roles: empty — no roles in MySQL for this user
    mockExecute.mockResolvedValueOnce([[], []]);

    // Attempt to access an admin-protected endpoint (reconciliation endpoint itself)
    const r = await request(app)
      .get("/api/access/rbac-reconciliation")
      .set("Authorization", "Bearer valid.staff.token");

    expect(r.status).toBe(403);
  });

  it("report does not auto-fix or backfill roles — mismatches are reported only", async () => {
    mockStaffAuth("user-admin");
    mockExecute.mockResolvedValueOnce([[{ role_key: "admin" }], []]);
    mockExecute.mockResolvedValueOnce([[], []]);
    mockFrom.mockReturnValueOnce({
      select: vi.fn(() => ({
        order: vi.fn(() =>
          Promise.resolve({
            data: [{ user_id: "u-ghost", role: "admin" }],
            error: null,
          })
        ),
      })),
    });

    const r = await request(app)
      .get("/api/access/rbac-reconciliation")
      .set("Authorization", "Bearer valid.staff.token");

    expect(r.status).toBe(200);
    // Only one execute call should have happened for the MySQL user_roles query
    // (requireRole check + access.service query = 2 execute calls, no INSERT/UPDATE)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writeCalls = mockExecute.mock.calls.filter(([sql]: any) =>
      typeof sql === "string" && /INSERT|UPDATE|DELETE/i.test(sql)
    );
    expect(writeCalls).toHaveLength(0);
  });
});
