import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ role: "hr", scope: { all: false, branchName: "NOIDA-2" } as { all: boolean; branchName: string | null } }));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "U1", role: h.role }; req.userRoles = [h.role]; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) => (roles.includes(req.authUser.role) ? next() : res.status(403).json({ success: false })),
}));
vi.mock("../he-stream.routes.js", () => ({ branchScopeOf: vi.fn(async () => h.scope) }));
vi.mock("../response-actions.service.js", async () => {
  const actual = await vi.importActual<typeof import("../response-actions.service.js")>("../response-actions.service.js");
  return {
    ResponseActionError: actual.ResponseActionError,
    manualResponse: vi.fn(async () => ({ responseId: 1, matchId: "M1", state: "confirmed" })),
    classifyResponse: vi.fn(async () => { throw new actual.ResponseActionError(409, "This reply was already handled"); }),
    ignoreResponse: vi.fn(async () => undefined),
  };
});
vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn() } }));

import { registerResponseRoutes } from "../response.routes.js";
import { manualResponse } from "../response-actions.service.js";

const app = express(); app.use(express.json());
const r = express.Router(); registerResponseRoutes(r, { view: ["hr", "ceo"], write: ["hr"] }); app.use("/api/he", r);
beforeEach(() => { h.role = "hr"; vi.mocked(manualResponse).mockClear(); });

describe("response routes", () => {
  it("manual confirm passes the actor and the caller's scope", async () => {
    const res = await request(app).post("/api/he/responses/manual").send({ mobile10: "9876543210", requisitionId: "11111111-1111-1111-1111-111111111111", answer: "confirm", note: "called", via: "phone_call" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { responseId: 1, matchId: "M1", state: "confirmed" } });
    expect(vi.mocked(manualResponse).mock.calls[0][0]).toMatchObject({ actor: "U1", answer: "confirm", via: "phone_call" });
    expect(vi.mocked(manualResponse).mock.calls[0][1]).toEqual({ all: false, branchName: "NOIDA-2" });
  });
  it("view-only role cannot write", async () => {
    h.role = "ceo";
    expect((await request(app).post("/api/he/responses/manual").send({})).status).toBe(403);
  });
  it("409 from the service is passed through with its message", async () => {
    const res = await request(app).post("/api/he/responses/7/classify").send({ answer: "confirm", apply: true });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already handled/);
  });
  it("bad id or body → 400", async () => {
    expect((await request(app).post("/api/he/responses/abc/classify").send({ answer: "confirm" })).status).toBe(400);
    expect((await request(app).post("/api/he/responses/7/classify").send({ answer: "nope" })).status).toBe(400);
    expect((await request(app).post("/api/he/responses/manual").send({ requisitionId: "x", answer: "confirm", note: "ok ok", via: "phone_call" })).status).toBe(400);
  });
  it("ignore → 200", async () => {
    expect((await request(app).post("/api/he/responses/7/ignore").send({ reason: "spam" })).status).toBe(200);
  });
});
