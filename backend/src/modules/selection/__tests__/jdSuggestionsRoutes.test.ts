import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "u1", role: "hr" },
  outOfScope: new Set<string>(),
  svc: {
    getSuggestions: vi.fn(async () => ({ suggestions: [] })),
    acceptSuggestions: vi.fn(async () => ({ versionId: "v1" })),
    dismissSuggestions: vi.fn(async () => ({ ids: [] })),
  },
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn() } }));
vi.mock("../../../middleware/authMiddleware.js", () => ({ requireAuth: (req: Request & { authUser?: unknown }, _res: Response, next: NextFunction) => { req.authUser = { ...h.user }; next(); } }));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: (...roles: string[]) => (req: Request & { authUser: { role: string } }, res: Response, next: NextFunction) => (roles.includes(req.authUser.role) ? next() : res.status(403).json({ success: false })),
}));
vi.mock("../../job-requisition/job-requisition.service.js", () => ({ jobRequisitionService: { isRequisitionVisible: vi.fn(async (_u: unknown, k: { id: string }) => !h.outOfScope.has(k.id)) } }));
vi.mock("../jd-suggestions.service.js", () => h.svc);

async function app() {
  const { criteriaRouter } = await import("../criteria.routes.js");
  const a = express(); a.use(express.json()); a.use("/api/job-requisition", criteriaRouter); return a;
}
const U = "/api/job-requisition/r1/criteria/suggestions";
beforeEach(() => { vi.clearAllMocks(); h.user = { id: "u1", role: "hr" }; h.outOfScope.clear(); });

describe("GET suggestions: criteria read roles and requisition scope", () => {
  it.each(["super_admin", "hr", "recruitment_hr", "branch_head", "ceo", "operations_manager"])("%s can read", async (role) => {
    h.user.role = role;
    const res = await request(await app()).get(U);
    expect(res.status).toBe(200);
    expect(h.svc.getSuggestions).toHaveBeenCalledWith("r1", role);
  });
  it("recruiter: 403", async () => {
    h.user.role = "recruiter";
    expect((await request(await app()).get(U)).status).toBe(403);
    expect(h.svc.getSuggestions).not.toHaveBeenCalled();
  });
  it("out of scope: 404", async () => {
    h.outOfScope.add("r1");
    expect((await request(await app()).get(U)).status).toBe(404);
  });
});

describe("POST accept / dismiss: criteria edit roles only", () => {
  it.each(["super_admin", "hr", "recruitment_hr", "branch_head"])("%s can accept", async (role) => {
    h.user.role = role;
    const res = await request(await app()).post(`${U}/accept`).send({ ids: ["a1b2c3d4e5f6"], values: { a1b2c3d4e5f6: 25 }, reason: "owner", dryRun: true });
    expect(res.status).toBe(200);
    expect(h.svc.acceptSuggestions).toHaveBeenCalledWith({ requisitionId: "r1", ids: ["a1b2c3d4e5f6"], values: { a1b2c3d4e5f6: 25 }, reason: "owner", actor: { id: "u1", role }, dryRun: true });
  });
  it.each(["recruiter", "ceo", "operations_manager"])("%s cannot accept or dismiss (403)", async (role) => {
    h.user.role = role;
    expect((await request(await app()).post(`${U}/accept`).send({ ids: ["a1b2c3d4e5f6"] })).status).toBe(403);
    expect((await request(await app()).post(`${U}/dismiss`).send({ ids: ["a1b2c3d4e5f6"] })).status).toBe(403);
    expect(h.svc.acceptSuggestions).not.toHaveBeenCalled();
    expect(h.svc.dismissSuggestions).not.toHaveBeenCalled();
  });
  it("bad bodies: 400", async () => {
    const a = await app();
    for (const body of [{}, { ids: [] }, { ids: "x" }, { ids: ["a"], reason: "x".repeat(301) }, { ids: ["a"], values: { a: "25" } }, { ids: Array.from({ length: 51 }, (_, i) => `id${i}`) }]) {
      expect((await request(a).post(`${U}/accept`).send(body)).status).toBe(400);
    }
    expect(h.svc.acceptSuggestions).not.toHaveBeenCalled();
  });
  it("service errors keep their status (409 closed, 400 reason)", async () => {
    h.svc.acceptSuggestions.mockRejectedValueOnce(Object.assign(new Error("Requisition is closed: its criteria are read-only"), { statusCode: 409 }));
    const res = await request(await app()).post(`${U}/accept`).send({ ids: ["a1"] });
    expect(res.status).toBe(409);
    expect(res.body.message).toBe("Requisition is closed: its criteria are read-only");
  });
  it("dismiss and undo", async () => {
    const res = await request(await app()).post(`${U}/dismiss`).send({ ids: ["a1"], undo: true });
    expect(res.status).toBe(200);
    expect(h.svc.dismissSuggestions).toHaveBeenCalledWith({ requisitionId: "r1", ids: ["a1"], undo: true, reason: null, actor: { id: "u1", role: "hr" } });
  });
});
