import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "u1", role: "hr" },
  outOfScope: new Set<string>(),
  svc: {
    saveRequisitionCriteria: vi.fn(async () => ({ versionId: "v1" })), bulkSaveCriteria: vi.fn(async () => []), copyCriteria: vi.fn(async () => []),
    getRequisitionCriteria: vi.fn(async () => ({ compiled: {} })), listCriteriaAudit: vi.fn(async () => ({ items: [], nextCursor: null })),
    applyTemplateToRequisition: vi.fn(async () => ({ versionId: null })),
  },
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn() } }));
vi.mock("../../../middleware/authMiddleware.js", () => ({ requireAuth: (req: any, _res: any, next: any) => { req.authUser = { ...h.user }; next(); } }));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) => (roles.includes(req.authUser.role) ? next() : res.status(403).json({ success: false })),
}));
vi.mock("../../job-requisition/job-requisition.service.js", () => ({ jobRequisitionService: { isRequisitionVisible: vi.fn(async (_u: unknown, k: { id: string }) => !h.outOfScope.has(k.id)) } }));
vi.mock("../criteria.service.js", async (orig) => ({ ...(await orig<typeof import("../criteria.service.js")>()), ...h.svc }));

async function app() {
  const { criteriaRouter } = await import("../criteria.routes.js");
  const a = express(); a.use(express.json()); a.use("/api/job-requisition", criteriaRouter); return a;
}
beforeEach(() => { vi.clearAllMocks(); h.user = { id: "u1", role: "hr" }; h.outOfScope.clear(); });

describe("criteria routes: roles", () => {
  it.each(["super_admin", "hr", "recruitment_hr", "branch_head"])("%s can save", async (role) => {
    h.user.role = role;
    const res = await request(await app()).put("/api/job-requisition/r1/criteria").send({ patch: { ageMin: 18 }, reason: "x" });
    expect(res.status).toBe(200);
    expect(h.svc.saveRequisitionCriteria).toHaveBeenCalledWith({ requisitionId: "r1", patch: { ageMin: 18 }, actor: { id: "u1", role }, source: "criteria_panel", reason: "x", dryRun: false });
  });
  it.each(["recruiter", "ceo", "operations_manager", "employee"])("%s cannot save (403)", async (role) => {
    h.user.role = role;
    const res = await request(await app()).put("/api/job-requisition/r1/criteria").send({ patch: { ageMin: 18 } });
    expect(res.status).toBe(403);
    expect(h.svc.saveRequisitionCriteria).not.toHaveBeenCalled();
  });
  it.each(["recruiter", "ceo", "hr_admin"])("%s can read", async (role) => {
    h.user.role = role;
    expect((await request(await app()).get("/api/job-requisition/r1/criteria")).status).toBe(200);
  });
  it("employee cannot read", async () => {
    h.user.role = "employee";
    expect((await request(await app()).get("/api/job-requisition/r1/criteria")).status).toBe(403);
  });
});

describe("criteria routes: scope", () => {
  it("a branch head on another branch's requisition gets 404 for read and write", async () => {
    h.user.role = "branch_head"; h.outOfScope.add("r-noida");
    const a = await app();
    expect((await request(a).get("/api/job-requisition/r-noida/criteria")).status).toBe(404);
    expect((await request(a).put("/api/job-requisition/r-noida/criteria").send({ patch: { ageMin: 18 }, reason: "x" })).status).toBe(404);
    expect(h.svc.saveRequisitionCriteria).not.toHaveBeenCalled();
  });
  it("copy refuses a target outside the caller's scope (403), and nothing runs", async () => {
    h.outOfScope.add("r9");
    const res = await request(await app()).post("/api/job-requisition/criteria/copy").send({ fromRequisitionId: "r1", toRequisitionIds: ["r2", "r9"], keys: ["age"] });
    expect(res.status).toBe(403);
    expect(h.svc.copyCriteria).not.toHaveBeenCalled();
  });
  it("bulk refuses when any id is out of scope", async () => {
    h.outOfScope.add("r2");
    expect((await request(await app()).post("/api/job-requisition/criteria/bulk").send({ requisitionIds: ["r1", "r2"], patch: { ageMin: 18 } })).status).toBe(403);
    expect(h.svc.bulkSaveCriteria).not.toHaveBeenCalled();
  });
});

describe("criteria routes: inputs and outcomes", () => {
  it("bulk and copy default to dry-run", async () => {
    const a = await app();
    await request(a).post("/api/job-requisition/criteria/bulk").send({ requisitionIds: ["r1", "r1"], patch: { ageMin: 18 } });
    expect(h.svc.bulkSaveCriteria).toHaveBeenCalledWith(expect.objectContaining({ requisitionIds: ["r1"], dryRun: true, replaceFilled: false }));
    await request(a).post("/api/job-requisition/criteria/copy").send({ fromRequisitionId: "r1", toRequisitionIds: ["r2"] });
    expect(h.svc.copyCriteria).toHaveBeenCalledWith(expect.objectContaining({ keys: "all", dryRun: true }));
  });
  it("bad bodies are 400", async () => {
    const a = await app();
    expect((await request(a).put("/api/job-requisition/r1/criteria").send({ patch: "x" })).status).toBe(400);
    expect((await request(a).put("/api/job-requisition/r1/criteria").send({ patch: {}, reason: "x".repeat(301) })).status).toBe(400);
    expect((await request(a).post("/api/job-requisition/criteria/bulk").send({ requisitionIds: [], patch: {} })).status).toBe(400);
    expect((await request(a).post("/api/job-requisition/criteria/copy").send({ fromRequisitionId: "r1", toRequisitionIds: ["r2"], keys: ["shoe"] })).status).toBe(400);
  });
  it("service status codes and issues pass through", async () => {
    h.svc.saveRequisitionCriteria.mockRejectedValueOnce(Object.assign(new Error("The criteria contradict each other"), { statusCode: 422, issues: [{ level: "error", keys: ["age"], text: "t" }] }));
    const res = await request(await app()).put("/api/job-requisition/r1/criteria").send({ patch: { ageMin: 40 } });
    expect(res.status).toBe(422);
    expect(res.body.issues).toHaveLength(1);
  });
  it("templates list is readable", async () => {
    const res = await request(await app()).get("/api/job-requisition/criteria/templates");
    expect(res.body.data.map((t: { id: string }) => t.id)).toEqual(["night_shift_bpo", "dra_collections", "telesales", "back_office"]);
  });
});
