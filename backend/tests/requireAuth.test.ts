import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import { requireAuth } from "../src/middleware/authMiddleware.js";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.get("/protected", requireAuth, (req: any, res) => {
    res.json({ success: true, userId: req.authUser?.id });
  });
  return app;
}

describe("requireAuth middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when Authorization header is missing", async () => {
    const res = await request(buildApp()).get("/protected");
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/Missing authorization token/i);
  });

  it("returns 401 when Authorization header does not start with Bearer", async () => {
    const res = await request(buildApp())
      .get("/protected")
      .set("Authorization", "Basic sometoken");
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/Missing authorization token/i);
  });

  it("returns 401 when token is not in demo map", async () => {
    const res = await request(buildApp())
      .get("/protected")
      .set("Authorization", "Bearer mock-token-unknown");
    expect(res.status).toBe(401);
  });

  it("attaches authUser and calls next for valid demo token", async () => {
    const res = await request(buildApp())
      .get("/protected")
      .set("Authorization", "Bearer mock-token-admin");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.userId).toBe("demo-admin-id");
  });

  it("attaches authUser for different demo roles", async () => {
    const res = await request(buildApp())
      .get("/protected")
      .set("Authorization", "Bearer mock-token-hr");
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe("demo-hr-id");
  });
});
