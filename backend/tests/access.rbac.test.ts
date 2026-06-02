/**
 * Package 0-B RBAC reconciliation tests.
 *
 * Verifies:
 * 1. Non-admin users get 403 on the reconciliation endpoint
 * 2. Admin users can retrieve the MySQL-only report
 * 3. Auth is enforced via MySQL JWT only (no Supabase fallback)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../src/db/mysql.js", () => ({
  db: { execute: vi.fn() },
  pingDb: vi.fn(),
}));

vi.mock("../src/modules/auth/auth.service.js", () => ({
  authService: {
    verifyAccessToken: vi.fn(),
  },
}));

import { app } from "../src/app.js";
import { db } from "../src/db/mysql.js";
import { authService } from "../src/modules/auth/auth.service.js";

const mockExecute = db.execute as ReturnType<typeof vi.fn>;
const mockVerifyAccessToken = authService.verifyAccessToken as ReturnType<typeof vi.fn>;

function mockMysqlJwtAuth(userId: string) {
  mockVerifyAccessToken.mockReturnValue({ id: userId, email: `${userId}@test.com` });
}

beforeEach(() => vi.clearAllMocks());

// ── 1. Non-admin blocked ──────────────────────────────────────────────────────

describe("GET /api/access/rbac-reconciliation — access control", () => {
  it("returns 401 with no token", async () => {
    const r = await request(app).get("/api/access/rbac-reconciliation");
    expect(r.status).toBe(401);
  });

  it("returns 401 with invalid JWT token", async () => {
    mockVerifyAccessToken.mockReturnValue(null);
    const r = await request(app)
      .get("/api/access/rbac-reconciliation")
      .set("Authorization", "Bearer invalid.token");
    expect(r.status).toBe(401);
  });

  it("returns 403 when authenticated user has employee role only (MySQL)", async () => {
    mockMysqlJwtAuth("user-employee");
    // MySQL user_roles — only employee
    mockExecute.mockResolvedValueOnce([[{ role_key: "employee" }], []]);

    const r = await request(app)
      .get("/api/access/rbac-reconciliation")
      .set("Authorization", "Bearer valid.staff.token");
    expect(r.status).toBe(403);
  });

  it("returns 403 when user has hr role only (not admin)", async () => {
    mockMysqlJwtAuth("user-hr");
    mockExecute.mockResolvedValueOnce([[{ role_key: "hr" }], []]);

    const r = await request(app)
      .get("/api/access/rbac-reconciliation")
      .set("Authorization", "Bearer valid.staff.token");
    expect(r.status).toBe(403);
  });
});

// ── 2. Admin can retrieve the MySQL-only report ───────────────────────────────

describe("GET /api/access/rbac-reconciliation — admin access", () => {
  it("returns 200 with MySQL-only reconciliation report for admin user", async () => {
    mockMysqlJwtAuth("user-admin");
    // requireRole check — admin
    mockExecute.mockResolvedValueOnce([[{ role_key: "admin" }], []]);
    // access.service: MySQL user_roles query
    mockExecute.mockResolvedValueOnce([[{ user_id: "u-1", role_key: "admin" }], []]);

    const r = await request(app)
      .get("/api/access/rbac-reconciliation")
      .set("Authorization", "Bearer valid.staff.token");

    expect(r.status).toBe(200);
    expect(r.body.data).toBeDefined();
    expect(r.body.data).toHaveProperty("roles_by_user");
    expect(r.body.data).toHaveProperty("total_mysql_users");
    expect(r.body.data).toHaveProperty("checked_at");
  });

  it("returns correct roles_by_user grouping", async () => {
    mockMysqlJwtAuth("user-admin");
    mockExecute.mockResolvedValueOnce([[{ role_key: "admin" }], []]);
    // MySQL user_roles: two rows for different users
    mockExecute.mockResolvedValueOnce([
      [
        { user_id: "u-1", role_key: "admin" },
        { user_id: "u-2", role_key: "hr" },
      ],
      [],
    ]);

    const r = await request(app)
      .get("/api/access/rbac-reconciliation")
      .set("Authorization", "Bearer valid.staff.token");

    expect(r.status).toBe(200);
    const report = r.body.data;
    expect(report.total_mysql_users).toBe(2);
    expect(report.roles_by_user["u-1"]).toContain("admin");
    expect(report.roles_by_user["u-2"]).toContain("hr");
  });
});

// ── 3. MySQL JWT is the only auth method ────────────────────────────────────

describe("RBAC authority — MySQL JWT is the only auth method", () => {
  it("user with no MySQL roles is denied protected API (403)", async () => {
    mockMysqlJwtAuth("user-no-roles");
    // MySQL user_roles: empty — no roles in MySQL for this user
    mockExecute.mockResolvedValueOnce([[], []]);

    const r = await request(app)
      .get("/api/access/rbac-reconciliation")
      .set("Authorization", "Bearer valid.jwt.token");

    expect(r.status).toBe(403);
  });

  it("report does not auto-fix or backfill roles — MySQL data is returned only", async () => {
    mockMysqlJwtAuth("user-admin");
    mockExecute.mockResolvedValueOnce([[{ role_key: "admin" }], []]);
    mockExecute.mockResolvedValueOnce([[], []]);

    const r = await request(app)
      .get("/api/access/rbac-reconciliation")
      .set("Authorization", "Bearer valid.staff.token");

    expect(r.status).toBe(200);
    // Only read calls should have happened — no INSERT/UPDATE/DELETE
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writeCalls = mockExecute.mock.calls.filter(([sql]: any) =>
      typeof sql === "string" && /INSERT|UPDATE|DELETE/i.test(sql)
    );
    expect(writeCalls).toHaveLength(0);
  });
});
