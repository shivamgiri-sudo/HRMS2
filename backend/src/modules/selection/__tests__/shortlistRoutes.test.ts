import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ user: { id: "u1", role: "hr" }, set: vi.fn(async () => ({ warning: null })), remove: vi.fn(async () => {}), history: vi.fn(async () => []) }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn() } }));
vi.mock("../../../middleware/authMiddleware.js", () => ({ requireAuth: (req: any, _res: any, next: any) => { req.authUser = { ...h.user }; next(); } }));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) => (roles.includes(req.authUser.role) ? next() : res.status(403).json({ success: false })),
}));
vi.mock("../override.service.js", async (orig) => ({ ...(await orig<typeof import("../override.service.js")>()), setOverride: h.set, removeOverride: h.remove, overrideHistory: h.history }));

async function app() {
  const { shortlistRouter } = await import("../shortlist.routes.js");
  const a = express(); a.use(express.json()); a.use("/api/he/shortlist", shortlistRouter); return a;
}
beforeEach(() => { vi.clearAllMocks(); h.user = { id: "u1", role: "hr" }; });

describe("override routes", () => {
  it.each(["super_admin", "admin", "hr", "recruitment_hr"])("%s may set an override", async (role) => {
    h.user.role = role;
    const res = await request(await app()).put("/api/he/shortlist/override").send({ mobile: "9876543210", requisitionScope: "r1", kind: "include", reason: "x" });
    expect(res.status).toBe(200);
    expect(h.set).toHaveBeenCalledWith(expect.objectContaining({ mobile: "9876543210", requisitionScope: "r1", kind: "include", reason: "x", actor: expect.objectContaining({ id: "u1", role }) }));
  });
  it.each(["recruiter", "ceo", "branch_head"])("%s cannot (403)", async (role) => {
    h.user.role = role;
    expect((await request(await app()).put("/api/he/shortlist/override").send({})).status).toBe(403);
    expect((await request(await app()).delete("/api/he/shortlist/override").send({})).status).toBe(403);
  });
  it("service 400/404 pass through", async () => {
    h.set.mockRejectedValueOnce(Object.assign(new Error("A reason (1-300 characters) is required"), { statusCode: 400 }));
    expect((await request(await app()).put("/api/he/shortlist/override").send({ mobile: "9876543210", requisitionScope: "r1", kind: "include", reason: "" })).status).toBe(400);
    h.remove.mockRejectedValueOnce(Object.assign(new Error("Requisition not found"), { statusCode: 404 }));
    expect((await request(await app()).delete("/api/he/shortlist/override").send({ mobile: "9876543210", requisitionScope: "rX", reason: "y" })).status).toBe(404);
  });
  it("history", async () => {
    expect((await request(await app()).get("/api/he/shortlist/override/history?mobile=9876543210")).status).toBe(200);
    expect(h.history).toHaveBeenCalledWith("9876543210", expect.objectContaining({ id: "u1" }));
  });
});

describe("approval routes", () => {
  it.each(["recruiter", "ceo", "admin", "branch_head"])("%s cannot approve (403)", async (role) => {
    h.user.role = role;
    expect((await request(await app()).post("/api/he/shortlist/approve").send({})).status).toBe(403);
    expect((await request(await app()).post("/api/he/shortlist/run").send({})).status).toBe(403);
  });
  it("bad bodies are 400", async () => {
    const a = await app();
    expect((await request(a).post("/api/he/shortlist/run").send({ requisitionId: "r1", sourceKind: "linkedin" })).status).toBe(400);
    expect((await request(a).post("/api/he/shortlist/approve").send({ requisitionId: "r1", sourceKind: "he", runId: "x", untick: ["123"] })).status).toBe(400);
    expect((await request(a).post("/api/he/shortlist/approve-standing").send({ requisitionId: "r1", versionId: "v", days: 2.5 })).status).toBe(400);
    expect((await request(a).post("/api/he/shortlist/reject").send({ requisitionId: "r1", mobiles: [] })).status).toBe(400);
  });
});

describe("after a criteria change", () => {
  it("release-held needs a follow-up id; booked-mismatch needs a requisition", async () => {
    const a = await app();
    expect((await request(a).post("/api/he/shortlist/release-held").send({})).status).toBe(400);
    expect((await request(a).get("/api/he/shortlist/booked-mismatch")).status).toBe(400);
  });
  it.each(["recruiter", "ceo"])("%s cannot release a hold or read the list (403)", async (role) => {
    h.user.role = role;
    const a = await app();
    expect((await request(a).post("/api/he/shortlist/release-held").send({ followupId: "x", reason: "y" })).status).toBe(403);
    expect((await request(a).get("/api/he/shortlist/booked-mismatch?requisitionId=r1")).status).toBe(403);
  });
});
