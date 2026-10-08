/** Pin (snapshot-first): the drives list statement an org-wide caller runs today. Branch scoping must leave it byte-identical. */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
vi.mock("../../../db/mysql.js", () => ({ db: { execute, query: execute, getConnection: vi.fn() } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
let actor: { id: string; role: string; roles: string[] };
vi.mock("../../../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../middleware/authMiddleware.js")>();
  return { ...original, requireAuth: (req: any, _res: any, next: any) => { req.authUser = actor; next(); } };
});
vi.mock("../he-inbox.service.js", () => ({ listInbox: vi.fn(), getInboxThread: vi.fn(), replyToCandidate: vi.fn() }));
vi.mock("../he-meta-recruitment.service.js", () => ({ getMetaRecruitment: vi.fn(async () => ({ campaigns: [], total: {} })) }));

import { heRouter } from "../he.routes.js";

const app = express(); app.use(express.json()); app.use("/api/he", heRouter);
beforeEach(() => {
  actor = { id: "u-ceo", role: "ceo", roles: ["ceo"] };
  execute.mockReset();
  execute.mockImplementation(async () => [[{ id: "D1" }]]);
});

describe("GET /api/he/drives (pin)", () => {
  it("org-wide caller: the statement and its parameters", async () => {
    const r = await request(app).get("/api/he/drives");
    expect(r.status).toBe(200);
    const call = execute.mock.calls.find(([q]) => String(q).includes("FROM he_drive d JOIN job_requisition jr"));
    expect(call).toMatchSnapshot();
  });
});
