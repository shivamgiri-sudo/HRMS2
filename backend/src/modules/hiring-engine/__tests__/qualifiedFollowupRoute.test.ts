import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../../db/mysql.js", () => ({
  db: { execute, query: execute, getConnection: vi.fn() },
}));

const { followupSummary } = vi.hoisted(() => ({ followupSummary: vi.fn() }));
vi.mock("../qualified-followup.service.js", () => ({
  followupSummary,
  enqueueQualifiedFollowup: vi.fn(),
  enqueueMetaLeadFollowup: vi.fn(),
}));

let actor: { id: string; role: string; roles: string[] };
vi.mock("../../../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../middleware/authMiddleware.js")>();
  return {
    ...original,
    requireAuth: (req: any, _res: any, next: any) => {
      req.authUser = actor;
      next();
    },
  };
});

import { heRouter } from "../he.routes.js";

function appFor(role: string) {
  actor = { id: `u-${role}`, role, roles: [role] };
  const app = express();
  app.use(express.json());
  app.use("/api/he", heRouter);
  return app;
}

describe("GET /api/he/qualified-followup/summary", () => {
  beforeEach(() => {
    followupSummary.mockReset();
    delete process.env.QUAL_FOLLOWUP_MODE;
  });

  it("returns mode off and empty data when env is unset", async () => {
    followupSummary.mockResolvedValue([]);
    const res = await request(appFor("hr")).get("/api/he/qualified-followup/summary");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, mode: "off", data: [] });
  });

  it("returns a generic 500 without stack or SQL when the summary throws", async () => {
    followupSummary.mockRejectedValue(new Error("SELECT * FROM he_followup boom at /srv/x.ts"));
    const res = await request(appFor("hr")).get("/api/he/qualified-followup/summary");
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/SELECT|boom|stack|\.ts/);
  });

  it("rejects roles outside VIEW_ROLES", async () => {
    const res = await request(appFor("employee")).get("/api/he/qualified-followup/summary");
    expect(res.status).toBe(403);
    expect(followupSummary).not.toHaveBeenCalled();
  });
});
