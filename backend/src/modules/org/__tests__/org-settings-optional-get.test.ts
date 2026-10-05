import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * /onboarding read GET /api/org/settings/employee_code_pattern on every load. The key is not
 * seeded on production, so every load logged a 404 even though the hook has a built-in default.
 * `?optional=1` lets such callers get 200 { data: null } for an unset key; callers that do not
 * opt in still get the 404 they rely on.
 */
const execute = vi.fn();

vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.authUser = { id: "user-1", role: "employee", roles: ["employee"] };
    next();
  },
}));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: (...a: unknown[]) => execute(...a) } }));

async function app() {
  const { orgSettingsRouter } = await import("../org_settings.routes.js");
  const a = express();
  a.use(express.json());
  a.use("/api/org/settings", orgSettingsRouter);
  return a;
}

describe("GET /api/org/settings/:key — unset key", () => {
  beforeEach(() => {
    execute.mockReset();
    execute.mockResolvedValue([[]]);
  });

  it("still 404s by default", async () => {
    const res = await request(await app()).get("/api/org/settings/employee_code_pattern");
    expect(res.status).toBe(404);
  });

  it("answers 200 with null data when optional=1", async () => {
    const res = await request(await app()).get("/api/org/settings/employee_code_pattern?optional=1");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: null });
  });

  it("returns the row unchanged when the key exists", async () => {
    execute.mockResolvedValue([[{ setting_key: "employee_code_pattern", setting_value: '{"prefix":"MAS"}' }]]);
    const res = await request(await app()).get("/api/org/settings/employee_code_pattern?optional=1");
    expect(res.status).toBe(200);
    expect(res.body.data.setting_value).toBe('{"prefix":"MAS"}');
  });
});
