import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Jobs: authenticated posting / walk-in mutations and the walk-in list are limited to the caller's branch. */
const { svc, scopeBox } = vi.hoisted(() => ({
  svc: {
    listPostings: vi.fn(async () => []), createPosting: vi.fn(async () => ({})), updatePosting: vi.fn(async () => ({})),
    listWalkin: vi.fn(async () => []), registerWalkin: vi.fn(async () => ({})), callCandidate: vi.fn(async () => ({})),
    updateWalkinStatus: vi.fn(async () => ({})), getBranchOf: vi.fn(),
  },
  scopeBox: { value: { orgWide: false, branchIds: ["b-noida"] } as any },
}));
vi.mock("../jobs.service.js", () => ({ jobsService: svc }));
vi.mock("../../ats-extensions/ats-ext-scope.js", () => ({
  resolveAtsBranchScope: vi.fn(async () => scopeBox.value),
  OUT_OF_SCOPE_MESSAGE: "Forbidden: record is outside your branch / assigned scope",
}));
vi.mock("../../../middleware/authMiddleware.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.authUser = { id: "u-hr" }; next(); },
}));
vi.mock("../../../middleware/requireRole.js", () => ({ requireRole: () => (_q: any, _s: any, next: any) => next() }));

async function app() {
  const { jobsRouter } = await import("../jobs.routes.js");
  const a = express(); a.use(express.json()); a.use("/api/jobs", jobsRouter); return a;
}
beforeEach(() => { vi.clearAllMocks(); scopeBox.value = { orgWide: false, branchIds: ["b-noida"] }; });

describe("jobs scope", () => {
  it("walk-in list is limited to the caller's branch ids; org-wide passes no restriction", async () => {
    const a = await app();
    await request(a).get("/api/jobs/walkin?branch_id=b-delhi");
    expect(svc.listWalkin).toHaveBeenCalledWith(expect.objectContaining({ branch_id: "b-delhi", scopeBranchIds: ["b-noida"] }));
    scopeBox.value = { orgWide: true, branchIds: [] };
    await request(a).get("/api/jobs/walkin");
    expect(svc.listWalkin).toHaveBeenLastCalledWith(expect.objectContaining({ scopeBranchIds: undefined }));
  });

  it("call / status on a foreign walk-in is 403; own is fine; missing is 404", async () => {
    const a = await app();
    svc.getBranchOf.mockResolvedValue("b-delhi");
    expect((await request(a).patch("/api/jobs/walkin/w1/call")).status).toBe(403);
    expect((await request(a).patch("/api/jobs/walkin/w1/status").send({ status: "done" })).status).toBe(403);
    expect(svc.callCandidate).not.toHaveBeenCalled();
    svc.getBranchOf.mockResolvedValue("b-noida");
    expect((await request(a).patch("/api/jobs/walkin/w1/call")).status).toBe(200);
    svc.getBranchOf.mockResolvedValue(undefined);
    expect((await request(a).patch("/api/jobs/walkin/w1/call")).status).toBe(404);
  });

  it("posting create / update are limited to the caller's branch; a posting with no branch is refused to hr", async () => {
    const a = await app();
    expect((await request(a).post("/api/jobs/postings").send({ title: "t", branch_id: "b-delhi" })).status).toBe(403);
    expect((await request(a).post("/api/jobs/postings").send({ title: "t" })).status).toBe(403);
    expect((await request(a).post("/api/jobs/postings").send({ title: "t", branch_id: "b-noida" })).status).toBe(201);
    svc.getBranchOf.mockResolvedValue("b-delhi");
    expect((await request(a).patch("/api/jobs/postings/p1").send({ title: "x" })).status).toBe(403);
    svc.getBranchOf.mockResolvedValue("b-noida");
    expect((await request(a).patch("/api/jobs/postings/p1").send({ branch_id: "b-delhi" })).status).toBe(403);
    expect((await request(a).patch("/api/jobs/postings/p1").send({ title: "x" })).status).toBe(200);
  });

  it("org-wide roles are unrestricted", async () => {
    scopeBox.value = { orgWide: true, branchIds: [] };
    const a = await app();
    expect((await request(a).post("/api/jobs/postings").send({ title: "t" })).status).toBe(201);
  });
});
