import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  user: { id: "u1", role: "hr" }, outOfScope: new Set<string>(),
  preview: vi.fn(async () => ({ steps: [] })), csv: vi.fn(async () => "mobile,first_name\n98xxxxxx10,A\n"), why: vi.fn(async () => []),
}));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: vi.fn() } }));
vi.mock("../../../middleware/authMiddleware.js", () => ({ requireAuth: (req: any, _res: any, next: any) => { req.authUser = { ...h.user }; next(); } }));
vi.mock("../../../middleware/requireRole.js", () => ({
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) => (roles.includes(req.authUser.role) ? next() : res.status(403).json({ success: false })),
}));
vi.mock("../../job-requisition/job-requisition.service.js", () => ({ jobRequisitionService: { isRequisitionVisible: vi.fn(async (_u: unknown, k: { id: string }) => !h.outOfScope.has(k.id)) } }));
vi.mock("../preview.service.js", () => ({ previewRequisition: h.preview, previewCsv: h.csv }));
vi.mock("../why-not.service.js", () => ({ whyNot: h.why }));

async function app() {
  const { criteriaRouter } = await import("../criteria.routes.js");
  const a = express(); a.use(express.json()); a.use("/api/job-requisition", criteriaRouter); return a;
}
beforeEach(() => { vi.clearAllMocks(); h.user = { id: "u1", role: "hr" }; h.outOfScope.clear(); });

describe("preview routes", () => {
  it("GET forwards source and sub-source", async () => {
    const res = await request(await app()).get("/api/job-requisition/r1/selection/preview?source=meta_live&sub=meta_live");
    expect(res.status).toBe(200);
    expect(h.preview).toHaveBeenCalledWith({ requisitionId: "r1", sourceKind: "meta_live", subSource: "meta_live" });
  });
  it("POST what-if passes the draft (never saved by the route)", async () => {
    await request(await app()).post("/api/job-requisition/r1/selection/preview").send({ source: "he", draft: { ageMin: 21 } });
    expect(h.preview).toHaveBeenCalledWith({ requisitionId: "r1", sourceKind: "he", subSource: "all", draft: { ageMin: 21 } });
  });
  it("Ahmedabad HR cannot preview a Noida requisition (404)", async () => {
    h.outOfScope.add("r-noida");
    const a = await app();
    expect((await request(a).get("/api/job-requisition/r-noida/selection/preview")).status).toBe(404);
    expect((await request(a).get("/api/job-requisition/r-noida/selection/preview.csv")).status).toBe(404);
    expect(h.preview).not.toHaveBeenCalled();
  });
  it("bad source or draft is 400", async () => {
    const a = await app();
    expect((await request(a).get("/api/job-requisition/r1/selection/preview?source=linkedin")).status).toBe(400);
    expect((await request(a).get("/api/job-requisition/r1/selection/preview?sub=bogus")).status).toBe(400);
    expect((await request(a).post("/api/job-requisition/r1/selection/preview").send({ draft: "x" })).status).toBe(400);
  });
  it.each(["recruiter", "ceo", "branch_head"])("%s may read the preview but not export the CSV", async (role) => {
    h.user.role = role;
    const a = await app();
    expect((await request(a).get("/api/job-requisition/r1/selection/preview")).status).toBe(200);
    expect((await request(a).get("/api/job-requisition/r1/selection/preview.csv")).status).toBe(403);
  });
  it.each(["super_admin", "hr", "recruitment_hr"])("%s exports a CSV attachment", async (role) => {
    h.user.role = role;
    const res = await request(await app()).get("/api/job-requisition/r1/selection/preview.csv?source=meta_old");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toContain("shortlist-preview-meta_old.csv");
  });
});

describe("why-not route", () => {
  it("passes the query, the caller and an optional requisition", async () => {
    const res = await request(await app()).get("/api/job-requisition/selection/why?q=9876543210&requisitionId=r1");
    expect(res.status).toBe(200);
    expect(h.why).toHaveBeenCalledWith("9876543210", { user: { id: "u1", role: "hr" }, requisitionId: "r1" });
  });
  it("a missing or very long query is 400; an employee is 403", async () => {
    const a = await app();
    expect((await request(a).get("/api/job-requisition/selection/why")).status).toBe(400);
    expect((await request(a).get(`/api/job-requisition/selection/why?q=${"x".repeat(81)}`)).status).toBe(400);
    h.user.role = "employee";
    expect((await request(a).get("/api/job-requisition/selection/why?q=abc")).status).toBe(403);
  });
});
