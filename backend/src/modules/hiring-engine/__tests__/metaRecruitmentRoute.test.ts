import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
const getMetaRecruitment = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
let actor: { id: string; role: string; roles: string[] };
vi.mock("../../../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../middleware/authMiddleware.js")>();
  return { ...original, requireAuth: (req: any, _res: any, next: any) => { req.authUser = actor; next(); } };
});
vi.mock("../he-inbox.service.js", () => ({ listInbox: vi.fn(), getInboxThread: vi.fn(), replyToCandidate: vi.fn() }));
vi.mock("../he-meta-funnel.service.js", () => ({ getMetaFunnel: vi.fn(async () => ({ campaigns: [] })) }));
vi.mock("../he-meta-recruitment.service.js", () => ({ getMetaRecruitment }));

import { heRouter } from "../he.routes.js";

function appFor(role: string) {
  actor = { id: `u-${role}`, role, roles: [role] };
  const app = express();
  app.use(express.json());
  app.use("/api/he", heRouter);
  return app;
}

beforeEach(() => {
  getMetaRecruitment.mockReset();
  getMetaRecruitment.mockResolvedValue({ campaigns: [], total: {} });
  execute.mockReset();
  execute.mockImplementation(async (sql: string) => (String(sql).includes("FROM employees e") ? [[{ branch_name: "PUNE" }]] : [[]]));
});

describe("GET /api/he/meta-recruitment", () => {
  it("passes the caller's branch scope: org-wide for ceo, the own branch for hr", async () => {
    expect((await request(appFor("ceo")).get("/api/he/meta-recruitment")).status).toBe(200);
    expect(getMetaRecruitment).toHaveBeenLastCalledWith({ all: true });
    expect((await request(appFor("hr")).get("/api/he/meta-recruitment")).status).toBe(200);
    expect(getMetaRecruitment).toHaveBeenLastCalledWith({ all: false, branchName: "PUNE" });
  });
  it("hr with no branch gets the no-branch scope (the service answers empty)", async () => {
    execute.mockImplementation(async () => [[]]);
    expect((await request(appFor("hr")).get("/api/he/meta-recruitment")).status).toBe(200);
    expect(getMetaRecruitment).toHaveBeenLastCalledWith({ all: false, branchName: null });
  });
  it("500 with a generic message when the read fails", async () => {
    getMetaRecruitment.mockRejectedValue(new Error("SELECT secret"));
    const r = await request(appFor("ceo")).get("/api/he/meta-recruitment");
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain("SELECT");
  });
});
