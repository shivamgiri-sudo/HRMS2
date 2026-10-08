import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ execute: vi.fn(), matrix: vi.fn(), branch: "NOIDA-2" }));
vi.mock("../../../db/mysql.js", () => ({ db: { execute: h.execute, query: h.execute, getConnection: vi.fn() } }));
vi.mock("../../../logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
let actor: { id: string; role: string; roles: string[] };
vi.mock("../../../middleware/authMiddleware.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../middleware/authMiddleware.js")>();
  return { ...original, requireAuth: (req: any, _res: any, next: any) => { req.authUser = actor; next(); } };
});
vi.mock("../campaign-matrix.service.js", () => ({ getCampaignMatrix: h.matrix, clearMatrixCache: vi.fn() }));

import { heRouter } from "../he.routes.js";

const RID = "0f1e2d3c-aaaa-4bbb-8ccc-0000000abcde";
function appFor(role: string) {
  actor = { id: `u-${role}`, role, roles: [role] };
  const app = express();
  app.use(express.json());
  app.use("/api/he", heRouter);
  return app;
}
beforeEach(() => {
  vi.clearAllMocks();
  h.execute.mockImplementation(async (sql: string) => (String(sql).includes("FROM employees e") ? [[{ branch_name: h.branch }]] : [[]]));
  h.matrix.mockResolvedValue({ rows: [], generatedAt: "t", partial: [], enforcedEndDate: false });
});

describe("GET /api/he/campaign-matrix (C2)", () => {
  it("view roles get the matrix with their branch scope", async () => {
    const r = await request(appFor("hr")).get("/api/he/campaign-matrix");
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ rows: [], generatedAt: "t", partial: [], enforcedEndDate: false });
    expect(h.matrix).toHaveBeenCalledWith({ branch: null, requisitionId: null, campaignId: null }, { all: false, branchName: "NOIDA-2" });
  });

  it("org-wide roles pass a branch filter; the CEO reads all branches", async () => {
    await request(appFor("ceo")).get("/api/he/campaign-matrix?branch=AHMEDABAD");
    expect(h.matrix).toHaveBeenCalledWith(expect.objectContaining({ branch: "AHMEDABAD" }), { all: true });
  });

  it("validates ids and branch", async () => {
    expect((await request(appFor("hr")).get("/api/he/campaign-matrix?requisitionId=nope")).status).toBe(400);
    expect((await request(appFor("hr")).get(`/api/he/campaign-matrix?campaignId=${"x".repeat(40)}`)).status).toBe(400);
    expect((await request(appFor("hr")).get(`/api/he/campaign-matrix?branch=${"b".repeat(151)}`)).status).toBe(400);
    expect((await request(appFor("hr")).get(`/api/he/campaign-matrix?requisitionId=${RID}`)).status).toBe(200);
  });

  it("recruiters are refused; a failure answers a fixed message", async () => {
    expect((await request(appFor("recruiter")).get("/api/he/campaign-matrix")).status).toBe(403);
    h.matrix.mockRejectedValueOnce(new Error("SELECT boom 9876543210"));
    const r = await request(appFor("hr")).get("/api/he/campaign-matrix");
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toMatch(/SELECT|\d{10}/);
  });
});
