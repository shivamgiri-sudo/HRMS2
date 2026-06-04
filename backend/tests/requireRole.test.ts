import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Mock the MySQL pool
vi.mock("../src/db/mysql.js", () => ({
  db: {
    execute: vi.fn().mockResolvedValue([[], []]),
  },
  pingDb: vi.fn(),
}));

// Mock supabaseAdmin so env parsing doesn't fail
vi.mock("../src/db/supabaseAdmin.js", () => ({
  supabaseAdmin: {},
  supabaseAuthClient: { auth: { getUser: vi.fn() } },
}));

import { db } from "../src/db/mysql.js";
import { requireRole } from "../src/middleware/requireRole.js";

const mockExecute = db.execute as ReturnType<typeof vi.fn>;

function buildApp(roles: string[]) {
  const app = express();
  app.use(express.json());

  // Simulate requireAuth already ran and attached authUser
  app.use((req: any, _res, next) => {
    req.authUser = { id: "user-abc", email: "test@mcn.com" };
    next();
  });

  app.get("/admin-only", requireRole(...roles), (_req, res) => {
    res.json({ success: true });
  });

  return app;
}

describe("requireRole middleware", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 401 when authUser is not attached", async () => {
    const app = express();
    app.get("/admin-only", requireRole("admin"), (_req, res) => {
      res.json({ success: true });
    });

    const res = await request(app).get("/admin-only");
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/Unauthenticated/i);
  });

  it("returns 403 when user has no matching role", async () => {
    // user only has 'employee' role
    mockExecute.mockResolvedValueOnce([[{ role_key: "employee" }], []]);

    const res = await request(buildApp(["admin"])).get("/admin-only");
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/Forbidden/i);
  });

  it("calls next when user has a matching role", async () => {
    mockExecute.mockResolvedValueOnce([[{ role_key: "admin" }], []]);

    const res = await request(buildApp(["admin"])).get("/admin-only");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("allows access when user has any of the allowed roles", async () => {
    mockExecute.mockResolvedValueOnce([[{ role_key: "hr" }], []]);

    const res = await request(buildApp(["admin", "hr"])).get("/admin-only");
    expect(res.status).toBe(200);
  });

  it("queries user_roles table with correct user_id", async () => {
    mockExecute.mockResolvedValueOnce([[{ role_key: "admin" }], []]);

    await request(buildApp(["admin"])).get("/admin-only");

    expect(mockExecute).toHaveBeenCalledOnce();
    const [sql, params] = mockExecute.mock.calls[0];
    expect(params).toContain("user-abc");
    // Must query user_roles table
    expect(sql).toMatch(/user_roles/i);
  });

  it("SQL query selects role_key directly from user_roles (no roles JOIN)", async () => {
    mockExecute.mockResolvedValueOnce([[{ role_key: "admin" }], []]);

    await request(buildApp(["admin"])).get("/admin-only");

    const [sql] = mockExecute.mock.calls[0];
    // The schema has role_key directly on user_roles — no 'roles' table exists
    expect(sql).not.toMatch(/JOIN\s+roles\b/i);
    expect(sql).toMatch(/user_roles/i);
  });
});
